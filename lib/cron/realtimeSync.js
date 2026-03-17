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
import { getBeijingDate } from '@/lib/utils';

// ── 常量 ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 1;   // 降为 1 以便精确控制子请求预算
const BATCH_DELAY_MS = 100;  // 批间等待（ms）
const SUBREQ_BUDGET = 45;    // D1 Free 计划硬上限 50
const FETCH_TIMEOUT = 5000; // 单资产行情超时（ms）

// 每隔多少次 cron 触发执行一次 pruneIntradayPoints
const PRUNE_EVERY_N = 6;

// ── 交易时段（北京时间）──────────────────────────────────────────────────────

const TRADING_SESSIONS = [
    { open: '09:30', close: '11:30' },
    { open: '13:00', close: '15:00' },
];

function _isTradingHour(now) {
    const bjNow = getBeijingDate();
    const h = bjNow.getHours();
    const m = bjNow.getMinutes();
    const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return TRADING_SESSIONS.some(s => hhmm >= s.open && hhmm <= s.close);
}

// ── 简单计数器（模块级，Worker 实例存活期间有效）────────────────────────────
let _triggerCount = 0;

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runRealtimeSync(env) {
    const now = new Date();

    if (!_isTradingHour(now)) {
        console.log('[RealtimeSync] Outside trading hours, skipped.');
        return;
    }

    _triggerCount++;
    const t0 = Date.now();
    let ok = 0, fail = 0, budgetExceeded = false;
    let subreqCount = 1; // 初始 DB List 请求占 1 次
    const errors = [];

    try {
        const { results: assets } = await env.DB
            .prepare("SELECT DISTINCT code, type FROM user_assets WHERE type != 'fund'")
            .all();

        if (!assets?.length) {
            console.log('[RealtimeSync] No stock assets, skipped.');
            return;
        }

        const points = [];

        for (let i = 0; i < assets.length; i++) {
            // 预估单次循环消耗：1 (Fetch) + 1 (Write) ≈ 2
            if (subreqCount >= SUBREQ_BUDGET) {
                const msg = `Budget reached (${subreqCount}/${SUBREQ_BUDGET}). Skipped remaining ${assets.length - i} stocks.`;
                console.warn(`[RealtimeSync] ${msg}`);
                budgetExceeded = true;
                break;
            }

            const asset = assets[i];
            try {
                const quote = await _fetchOne(asset);
                if (quote) {
                    points.push(quote);
                    ok++;
                }
                subreqCount += 1;
            } catch (e) {
                fail++;
                errors.push(`${asset.code} — ${e.message}`);
                subreqCount += 1;
            }

            if (i < assets.length - 1) await _sleep(BATCH_DELAY_MS);
        }

        if (points.length > 0) {
            await saveIntradayPointsBulk(points, env);
            subreqCount += 1;
        }

        // 4. 定期清理（每 PRUNE_EVERY_N 次触发一次，排除刚启动时的 0 计数）
        if (_triggerCount > 0 && _triggerCount % PRUNE_EVERY_N === 0 && subreqCount < 48) {
            await pruneIntradayPoints(env);
            console.log(`[RealtimeSync] pruneIntradayPoints executed (trigger #${_triggerCount})`);
        }

        // 5. 日志：只在有失败或熔断时写 D1
        const elapsed = Math.round((Date.now() - t0) / 1000);
        if (fail > 0 || budgetExceeded) {
            const summary = `Done in ${elapsed}s — ${ok} OK, ${fail} failed, Budget Exceeded: ${budgetExceeded} / ${assets.length} total`;
            await _log(env, 'WARN', 'RealtimeSync', summary);
            if (errors.length) {
                await _log(env, 'ERROR', 'RealtimeSync',
                    `Errors: ${errors.slice(0, 5).join(' | ')}`);
            }
        } else {
            console.log(`[RealtimeSync] Done in ${elapsed}s — ${ok}/${assets.length} OK (Subreqs: ${subreqCount})`);
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

async function _log(env, level, module, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, module, message) VALUES (?, ?, ?)')
            .bind(level, module, message)
            .run();
    } catch (e) {
        console.error('[RealtimeSync] log write failed:', e.message);
    }
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
