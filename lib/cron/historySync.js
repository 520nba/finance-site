/**
 * src/lib/cron/historySync.js
 *
 * 历史数据增量同步，由 scheduled handler 在以下时间调用：
 *   周一到周五 21:00（北京）— 收盘后全量刷新
 *   周一到周六 03:00（北京）— 凌晨补跑，确保数据完整
 *
 * 对齐 historyRepo.js 的实际存储结构：
 *   表名       asset_history
 *   日期字段   record_date（非 date）
 *   写入方法   insertDailyPricesBatch（内含物理截断，保留最近 250 条）
 *
 * 流程：
 *   1. 查询 user_assets 所有资产
 *   2. 分批并发拉取外部历史接口（每批 BATCH_SIZE 条，批间延迟防限流）
 *   3. 对每条资产查询 MAX(record_date) 做增量过滤，只写新数据
 *   4. 调用 insertDailyPricesBatch 写入 asset_history（含自动截断）
 *   5. 汇总写入 system_logs
 *
 * 时间限制：scheduled handler 通过 ctx.waitUntil 运行，CPU 上限约 15 分钟。
 */

import { fetchStockHistory, fetchFundHistory } from '@/lib/services/historyFetcher';
import { insertDailyPricesBatch } from '@/lib/storage/historyRepo';

// ── 常量 ────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 1;    // 降为 1 以便精确控制子请求预算
const BATCH_DELAY_MS = 100;   // 批间等待（ms）
const SUBREQ_BUDGET = 45;    // D1 Free 计划硬上限 50，保留 5 次用于日志/基础开销
const FETCH_TIMEOUT = 8000;  // 单资产拉取超时（ms）
const HISTORY_DAYS = 365;   // 每次拉取的历史天数（historyRepo 会截断至 250 条）

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runHistorySync(env, options = {}) {
    const force = options.force === true;
    const t0 = Date.now();
    let ok = 0, fail = 0, budgetExceeded = false;
    let subreqCount = 1; // 初始 DB List 请求占 1 次
    const errors = [];

    try {
        const { results: assets } = await env.DB
            .prepare('SELECT DISTINCT code, type FROM user_assets')
            .all();

        if (!assets?.length) {
            await _log(env, 'INFO', 'HistorySync', 'No assets, skipped.');
            return;
        }

        console.log(`[HistorySync] Starting for ${assets.length} assets ${force ? '(FORCE REFRESH)' : ''}`);

        for (let i = 0; i < assets.length; i++) {
            // 预估单次循环消耗：1 (Check) + 1-3 (Fetch) + 1 (Write) ≈ 5
            if (subreqCount >= SUBREQ_BUDGET) {
                const msg = `Budget reached (${subreqCount}/${SUBREQ_BUDGET}). Skipped remaining ${assets.length - i} assets.`;
                console.warn(`[HistorySync] ${msg}`);
                await _log(env, 'WARN', 'HistorySync', msg);
                budgetExceeded = true;
                break;
            }

            const asset = assets[i];
            try {
                const consumed = await _syncOne(env, asset, force);
                subreqCount += consumed;
                ok++;
            } catch (e) {
                fail++;
                errors.push(`${asset.type}:${asset.code} — ${e.message}`);
                subreqCount += 2; // 即便失败，通常也消耗了 Check + Fetch
            }

            if (i < assets.length - 1) await _sleep(BATCH_DELAY_MS);
        }

        const elapsed = Math.round((Date.now() - t0) / 1000);
        const summary = `Done in ${elapsed}s — ${ok} OK, ${fail} failed, Budget Exceeded: ${budgetExceeded} / ${assets.length} total`;
        console.log(`[HistorySync] ${summary}`);
        await _log(env, fail > 0 || budgetExceeded ? 'WARN' : 'INFO', 'HistorySync', summary);

        // 5. 定期清理任务 (SaaS: 自动删除过期会话)
        if (subreqCount < 48) { // 留最后几格配额给清理操作
            await env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();
        }

        if (errors.length) {
            await _log(env, 'ERROR', 'HistorySync',
                `Errors: ${errors.slice(0, 5).join(' | ')}`);
        }
    } catch (e) {
        console.error('[HistorySync] Fatal:', e.message);
        await _log(env, 'ERROR', 'HistorySync', `Fatal: ${e.message}`);
    }
}

// ── 单资产同步 ───────────────────────────────────────────────────────────────

async function _syncOne(env, asset) {
    const { code, type } = asset;
    let consumed = 1; // 初始 DB Check 占 1 次

    // 1. 查本地最新日期
    const row = await env.DB
        .prepare('SELECT MAX(record_date) AS latest FROM asset_history WHERE code = ? AND type = ?')
        .bind(code.toLowerCase(), type)
        .first();
    const latestDate = row?.latest ?? null;

    // 2. 拉取外部数据
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    let history;
    try {
        // 因 fetchWithRetry 已改为 retry=0，此处固定占 1 次或多源级联 N 次
        history = type === 'fund'
            ? await fetchFundHistory(code, HISTORY_DAYS, ctrl.signal)
            : await fetchStockHistory(code, HISTORY_DAYS, ctrl.signal);

        consumed += (type === 'stock') ? 3 : 1; // 股票级联 3 源，基金 1 源
    } finally {
        clearTimeout(tid);
    }

    if (!history?.length) {
        console.log(`[HistorySync] ${type}:${code} skipped: empty response`);
        return consumed;
    }

    // 3. 增量过滤 (如果是 force 模式，则全量保留)
    const newRecords = (latestDate && !force)
        ? history.filter(h => h.date > latestDate)
        : history;

    if (!newRecords.length) {
        return consumed;
    }

    // 4. 批量写入 (1 次 D1 请求)
    await insertDailyPricesBatch(
        newRecords.map(r => ({ code, type, price: r.value, date: r.date })),
        env
    );
    consumed += 1;

    console.log(`[HistorySync] ${type}:${code} +${newRecords.length}`);
    return consumed;
}


// ── 工具 ─────────────────────────────────────────────────────────────────────

async function _log(env, level, module, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, module, message) VALUES (?, ?, ?)')
            .bind(level, module, message)
            .run();
    } catch (e) {
        console.error('[HistorySync] log write failed:', e.message);
    }
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
