import { queryAll, runSql, batchSql, getD1Storage } from './d1Client';

/**
 * 从 D1 获取资产历史数据
 */
export async function getHistory(code, type, days = 250) {
    try {
        // 获取最新的 days 天数据：先按日期倒序限制，再正序排列返回给前端
        const querySql = `
            SELECT value, date FROM (
                SELECT price as value, record_date as date 
                FROM asset_history 
                WHERE code = ? AND type = ? 
                ORDER BY record_date DESC 
                LIMIT ?
            ) ORDER BY date ASC
        `;
        return await queryAll(querySql, [code, type, days]);
    } catch (e) {
        console.error(`[HistoryRepo] getHistory failed for ${type}:${code}:`, e.message);
        return [];
    }
}

/**
 * 批量获取资产历史数据
 * @param {Array<{type: string, code: string}>} items 
 */
export async function getBulkHistory(items, days = 250) {
    if (!items || items.length === 0) return {};

    const result = {};
    // 由于 SQL 不太好在一个查询中为每个 code 返回独立的 LIMIT N，
    // 对于 60 个资产，我们可以考虑并发查询（D1 支持并行查询）
    const promises = items.map(async (it) => {
        const key = `${it.type}:${it.code}`;
        const history = await getHistory(it.code, it.type, days);
        if (history.length > 0) {
            result[key] = history;
        }
    });

    await Promise.all(promises);
    return result;
}

/**
 * 插入或更新单条历史记录
 */
export async function insertDailyPrice(code, type, price, date) {
    try {
        await runSql(
            'INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)',
            [code, type, price, date]
        );
    } catch (e) {
        console.error(`[HistoryRepo] insertDailyPrice failed:`, e.message);
    }
}

/**
 * 批量插入历史记录 (Cron 任务核心)
 * 使用 D1 的 batch 操作以获得最高性能
 */
export async function insertDailyPricesBatch(records) {
    if (!records || records.length === 0) return;

    const db = await getD1Storage();
    if (!db) return;

    try {
        const statements = records.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                .bind(r.code, r.type, r.price, r.date)
        );

        // 分片执行批量任务 (D1 有单次执行限制，通常一次不建议超过 100 条)
        const CHUNK_SIZE = 100;
        for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
            const chunk = statements.slice(i, i + CHUNK_SIZE);
            await db.batch(chunk);
        }
    } catch (e) {
        console.error(`[HistoryRepo] insertDailyPricesBatch failed:`, e.message);
    }
}
