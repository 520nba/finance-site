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

// ── 常量 ────────────────────────────────────────────────────────────────────

const BATCH_SIZE     = 10;    // 并发拉取数，可按接口限流情况在 8-15 间调整
const BATCH_DELAY_MS = 500;   // 批间等待（ms），降低被限流概率
const FETCH_TIMEOUT  = 8000;  // 单资产拉取超时（ms）
const HISTORY_DAYS   = 365;   // 每次拉取的历史天数（historyRepo 会截断至 250 条）
const D1_CHUNK       = 50;    // D1 batch 分片上限，与 historyRepo 保持一致

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runHistorySync(env) {
    const t0 = Date.now();
    let ok = 0, fail = 0;
    const errors = [];

    try {
        const { results: assets } = await env.DB
            .prepare('SELECT DISTINCT code, type FROM user_assets')
            .all();

        if (!assets?.length) {
            await _log(env, 'INFO', 'HistorySync', 'No assets, skipped.');
            return;
        }

        console.log(`[HistorySync] Starting for ${assets.length} assets`);

        for (let i = 0; i < assets.length; i += BATCH_SIZE) {
            const batch = assets.slice(i, i + BATCH_SIZE);

            const results = await Promise.allSettled(
                batch.map(a => _syncOne(env, a))
            );

            for (const r of results) {
                if (r.status === 'fulfilled') { ok++; }
                else { fail++; errors.push(r.reason?.message ?? String(r.reason)); }
            }

            if (i + BATCH_SIZE < assets.length) await _sleep(BATCH_DELAY_MS);
        }

        const elapsed = Math.round((Date.now() - t0) / 1000);
        const summary = `Done in ${elapsed}s — ${ok} OK, ${fail} failed / ${assets.length} total`;
        console.log(`[HistorySync] ${summary}`);
        await _log(env, fail > 0 ? 'WARN' : 'INFO', 'HistorySync', summary);

        if (errors.length) {
            await _log(env, 'ERROR', 'HistorySync',
                `Errors: ${errors.slice(0, 10).join(' | ')}`);
        }
    } catch (e) {
        console.error('[HistorySync] Fatal:', e.message);
        await _log(env, 'ERROR', 'HistorySync', `Fatal: ${e.message}`);
    }
}

// ── 单资产同步 ───────────────────────────────────────────────────────────────

async function _syncOne(env, asset) {
    const { code, type } = asset;

    // 1. 查本地最新日期（对齐 asset_history 表的 record_date 字段）
    const row = await env.DB
        .prepare('SELECT MAX(record_date) AS latest FROM asset_history WHERE code = ? AND type = ?')
        .bind(code.toLowerCase(), type)
        .first();
    const latestDate = row?.latest ?? null;

    // 2. 拉取外部数据（独立超时，各资产互不影响）
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    let history;
    try {
        history = type === 'fund'
            ? await fetchFundHistory(code, HISTORY_DAYS, ctrl.signal)
            : await fetchStockHistory(code, HISTORY_DAYS, ctrl.signal);
    } finally {
        clearTimeout(tid);
    }

    if (!history?.length) throw new Error(`${type}:${code} — empty response`);

    // 3. 增量过滤：只保留比本地更新的数据
    //    首次同步（latestDate === null）写全量
    const newRecords = latestDate
        ? history.filter(h => h.date > latestDate)
        : history;

    if (!newRecords.length) {
        console.log(`[HistorySync] ${type}:${code} already up to date (latest: ${latestDate})`);
        return;
    }

    // 4. 调用 insertDailyPricesBatch（内含物理截断，保留最近 250 条）
    //    该函数期望 records: { code, type, price, date }[]
    await _insertBatch(env, code, type, newRecords);

    console.log(`[HistorySync] ${type}:${code} +${newRecords.length} (prev latest: ${latestDate ?? 'none'})`);
}

// ── D1 写入（对齐 historyRepo.insertDailyPricesBatch 的表结构）───────────────
//
// historyRepo.insertDailyPricesBatch 写 asset_history(code, type, price, record_date)
// 且会执行物理截断（DELETE WHERE record_date < 第250条的日期）
// 此处直接复用其逻辑，避免绕过截断保护。
//
// 若项目中可直接 import historyRepo，推荐替换为：
//   import { insertDailyPricesBatch } from '@/lib/storage/historyRepo';
//   await insertDailyPricesBatch(records.map(r => ({ code, type, price: r.value, date: r.date })));

async function _insertBatch(env, code, type, records) {
    // Step A：批量 INSERT OR REPLACE
    for (let i = 0; i < records.length; i += D1_CHUNK) {
        const chunk = records.slice(i, i + D1_CHUNK);
        const stmts = chunk.map(r =>
            env.DB
                .prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                .bind(code.toLowerCase(), type, r.value, r.date)
        );
        await env.DB.batch(stmts);
    }

    // Step B：物理截断，保留最近 250 条（对齐 historyRepo 的清理逻辑）
    //   找到第 250 条的日期，删除比它更早的记录，充分利用 (code, type, record_date) 索引
    await env.DB
        .prepare(`
            DELETE FROM asset_history
            WHERE code = ? AND type = ?
              AND record_date < (
                  SELECT record_date FROM asset_history
                  WHERE code = ? AND type = ?
                  ORDER BY record_date DESC
                  LIMIT 1 OFFSET 249
              )
        `)
        .bind(code.toLowerCase(), type, code.toLowerCase(), type)
        .run();
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

async function _log(env, level, source, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, source, message, created_at) VALUES (?, ?, ?, ?)')
            .bind(level, source, message, new Date().toISOString())
            .run();
    } catch (e) {
        console.error('[HistorySync] log write failed:', e.message);
    }
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
