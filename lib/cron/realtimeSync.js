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

function _isTradingHour() {
    const bjNow = getBeijingDate();
    const h = bjNow.getHours();
    const m = bjNow.getMinutes();
    const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return TRADING_SESSIONS.some(s => hhmm >= s.open && hhmm <= s.close);
}

// ── 简单计数器（模块级，Worker 实例存活期间有效）────────────────────────────


// ── 主入口 ──────────────────────────────────────────────────────────────────

const TENCENT_BATCH_SIZE = 20;

export async function runRealtimeSync(env) {
    if (!_isTradingHour()) {
        console.log('[RealtimeSync] Outside trading hours, skipped.');
        return;
    }

    const t0 = Date.now();
    let ok = 0, fail = 0;
    let subreqCount = 1; // 初始 DB List 请求
    const logBuffer = [];

    try {
        const { results: assets } = await env.DB
            .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'stock'")
            .all();

        if (!assets?.length) {
            console.log('[RealtimeSync] No stock assets, skipped.');
            return;
        }

        const codes = assets.map(a => a.code);
        const points = [];
        const bjNow = getBeijingDate();
        const timeStr = `${String(bjNow.getHours()).padStart(2, '0')}:${String(bjNow.getMinutes()).padStart(2, '0')}`;

        // 批量抓取（每 20 个资产消耗 1 个子请求）
        for (let i = 0; i < codes.length; i += TENCENT_BATCH_SIZE) {
            if (subreqCount >= SUBREQ_BUDGET) {
                logBuffer.push({ level: 'WARN', msg: `Budget exceeded at index ${i}` });
                break;
            }

            const batch = codes.slice(i, i + TENCENT_BATCH_SIZE);
            try {
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);

                const url = `https://qt.gtimg.cn/q=${batch.join(',')}`;
                const res = await fetch(url, {
                    headers: { 'Referer': 'https://gu.qq.com/' },
                    signal: ctrl.signal
                });
                clearTimeout(tid);
                subreqCount += 1;

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const ab = await res.arrayBuffer();
                const text = new TextDecoder('gbk').decode(ab);

                // 解析腾讯行情格式 v_sz000001="...~...~..."
                for (const line of text.split(';').filter(l => l.trim())) {
                    const m = line.match(/v_([^=]+)="([^"]+)"/);
                    if (!m) continue;
                    const parts = m[2].split('~');
                    if (parts.length < 37) continue;

                    points.push({
                        code: m[1].toLowerCase(),
                        time: timeStr,
                        price: parseFloat(parts[3]) || 0,
                        vol: parseInt(parts[36], 10) || 0,
                    });
                    ok++;
                }
            } catch (e) {
                fail += batch.length;
                logBuffer.push({ level: 'ERROR', msg: `Batch ${batch[0]}... failed: ${e.message}` });
            }
        }

        if (points.length > 0) {
            await saveIntradayPointsBulk(points, env);
            subreqCount += 1;
        }

        if (Math.random() < (1 / PRUNE_EVERY_N) && subreqCount < 48) {
            await pruneIntradayPoints(env);
            console.log(`[RealtimeSync] pruneIntradayPoints executed by probability (1/${PRUNE_EVERY_N})`);
        }

        const elapsed = Math.round((Date.now() - t0) / 1000);
        const statsSummary = `Done in ${elapsed}s — ${ok} OK, ${fail} failed, Subreqs: ${subreqCount}/${SUBREQ_BUDGET}`;

        if (fail > 0) {
            logBuffer.push({ level: 'INFO', msg: statsSummary });
        } else {
            console.log(`[RealtimeSync] ${statsSummary}`);
        }

        if (logBuffer.length > 0) {
            await _flushLogs(env, logBuffer);
        }

    } catch (e) {
        console.error('[RealtimeSync] Fatal:', e.message);
        await _flushLogs(env, [{ level: 'FATAL', msg: e.message }]);
    }
}

// ── 聚合日志写入 ────────────────────────────────────────────────────────────

async function _flushLogs(env, buffer) {
    if (!buffer || buffer.length === 0) return;
    try {
        const summary = buffer.map(item => `[${item.level}] ${item.msg}`).join(' | ');
        await env.DB
            .prepare('INSERT INTO system_logs (level, module, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
            .bind('INFO', 'RealtimeSync', summary)
            .run();
    } catch (e) {
        console.error('[RealtimeSync] flush logs failed:', e.message);
    }
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
