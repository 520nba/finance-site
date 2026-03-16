/**
 * src/lib/cron/realtimeSync.js
 *
 * 盘中实时行情抓取，每 5 分钟由 scheduled handler 调用。
 * 触发窗口：周一到周五 UTC 01:00-07:55 = 北京时间 09:00-15:55。
 *
 * 对齐 intradayRepo.js 的实际存储结构：
 *   主表  asset_intraday_points (code, time, price, vol)  — 逐点存储，供分时图使用
 *   日表  asset_intraday (code, record_date, data)        — JSON 全天数据，供收盘后归档
 *
 * intradayRepo 说明：
 *   - saveIntraday 有盘中/收盘自动切换逻辑，但依赖 memoryCache。
 *     scheduled handler 每次都是全新 Worker 实例，内存不持久，
 *     因此盘中 cron 直接写 asset_intraday_points（持久化），不依赖内存缓存。
 *   - saveIntradayPointsBulk / pruneIntradayPoints 是专为 cron 设计的接口，直接使用。
 *
 * 流程：
 *   1. 判断当前是否在交易时段（09:30-11:30 / 13:00-15:00），非交易时段静默跳过
 *   2. 从 user_assets 读取所有股票资产（基金无盘中分时，跳过）
 *   3. 分批并发拉取实时行情（每批 BATCH_SIZE 条）
 *   4. 调用 saveIntradayPointsBulk 写入 asset_intraday_points
 *   5. 每隔 PRUNE_EVERY_N 次触发一次 pruneIntradayPoints，防止无限增长
 *   6. 失败时写 system_logs，成功时仅打 console（盘中高频，避免刷爆日志）
 *
 * pruneIntradayPoints 说明：
 *   每只股票保留最近 480 个分时点（约 4 天 × 每天 48 个5分钟K线），
 *   每次全部 cron 触发都清理成本较高，故每 6 次（约 30 分钟）触发一次。
 */

import { fetchStockQuote } from '@/lib/services/quoteFetcher';
import { saveIntradayPointsBulk, pruneIntradayPoints } from '@/lib/storage/intradayRepo';

// ── 常量 ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 15;   // 并发拉取数，实时接口较宽松
const BATCH_DELAY_MS = 300;  // 批间等待（ms）
const FETCH_TIMEOUT = 5000; // 单资产行情超时（ms）

// 每隔多少次 cron 触发执行一次 pruneIntradayPoints
// 每 5 分钟触发一次，6 次 = 约 30 分钟清理一次
const PRUNE_EVERY_N = 6;

// ── 交易时段（北京时间）──────────────────────────────────────────────────────

const TRADING_SESSIONS = [
    { open: '09:30', close: '11:30' },
    { open: '13:00', close: '15:00' },
];

function _isTradingHour(now) {
    const hhmm = now.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }); // 例如 "09:35"
    return TRADING_SESSIONS.some(s => hhmm >= s.open && hhmm <= s.close);
}

// ── 简单计数器（模块级，Worker 实例存活期间有效）────────────────────────────
// scheduled handler 每次触发都是同一个 Worker 实例（Cloudflare 会复用），
// 所以模块级变量在连续触发间是持久的，可用于计数。
// 即便实例被回收重置，也只是多跑一次 prune，无副作用。
let _triggerCount = 0;

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runRealtimeSync(env) {
    const now = new Date();

    // 非交易时段静默退出（cron 表达式已覆盖 09:00-15:55，此处作精细化兜底）
    if (!_isTradingHour(now)) {
        console.log('[RealtimeSync] Outside trading hours, skipped.');
        return;
    }

    _triggerCount++;
    const t0 = Date.now();
    let ok = 0, fail = 0;
    const errors = [];

    try {
        // 1. 只抓股票，基金无盘中分时
        const { results: assets } = await env.DB
            .prepare("SELECT DISTINCT code, type FROM user_assets WHERE type != 'fund'")
            .all();

        if (!assets?.length) {
            console.log('[RealtimeSync] No stock assets, skipped.');
            return;
        }

        // 2. 分批并发拉取
        const points = []; // 准备写入 asset_intraday_points 的记录

        for (let i = 0; i < assets.length; i += BATCH_SIZE) {
            const batch = assets.slice(i, i + BATCH_SIZE);

            const results = await Promise.allSettled(
                batch.map(a => _fetchOne(a))
            );

            for (const r of results) {
                if (r.status === 'fulfilled') {
                    points.push(r.value);
                    ok++;
                } else {
                    fail++;
                    errors.push(r.reason?.message ?? String(r.reason));
                }
            }

            if (i + BATCH_SIZE < assets.length) await _sleep(BATCH_DELAY_MS);
        }

        // 3. 批量写入 asset_intraday_points
        //    saveIntradayPointsBulk 期望：{ code, time, price, vol }[]
        if (points.length > 0) {
            await saveIntradayPointsBulk(points, env);
        }

        // 4. 定期清理（每 PRUNE_EVERY_N 次触发一次）
        if (_triggerCount % PRUNE_EVERY_N === 0) {
            await pruneIntradayPoints(env);
            console.log(`[RealtimeSync] pruneIntradayPoints executed (trigger #${_triggerCount})`);
        }

        // 5. 日志：只在有失败时写 D1（成功仅 console，避免高频刷日志）
        const elapsed = Math.round((Date.now() - t0) / 1000);
        if (fail > 0) {
            const summary = `Done in ${elapsed}s — ${ok} OK, ${fail} failed / ${assets.length} total`;
            await _log(env, 'WARN', 'RealtimeSync', summary);
            await _log(env, 'ERROR', 'RealtimeSync',
                `Errors: ${errors.slice(0, 10).join(' | ')}`);
        } else {
            console.log(`[RealtimeSync] Done in ${elapsed}s — ${ok}/${assets.length} OK`);
        }

    } catch (e) {
        console.error('[RealtimeSync] Fatal:', e.message);
        await _log(env, 'ERROR', 'RealtimeSync', `Fatal: ${e.message}`);
    }
}

// ── 单资产行情拉取 ────────────────────────────────────────────────────────────

async function _fetchOne(asset) {
    const { code } = asset;

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);

    try {
        // fetchStockQuote 返回 { code, type, price, changePct, time, vol }
        // time 已是 "HH:MM" 格式，直接对应 asset_intraday_points.time
        return await fetchStockQuote(code, ctrl.signal);
    } finally {
        clearTimeout(tid);
    }
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

async function _log(env, level, source, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, source, message, created_at) VALUES (?, ?, ?, ?)')
            .bind(level, source, message, new Date().toISOString())
            .run();
    } catch (e) {
        console.error('[RealtimeSync] log write failed:', e.message);
    }
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
