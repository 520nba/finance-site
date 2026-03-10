import pLimit from 'p-limit';
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

    const db = await getD1Storage();
    if (!db) return {};

    const result = {};
    const querySql = `
        SELECT value, date FROM (
            SELECT price as value, record_date as date 
            FROM asset_history 
            WHERE code = ? AND type = ? 
            ORDER BY record_date DESC 
            LIMIT ?
        ) ORDER BY date ASC
    `;

    try {
        // 使用 D1 的 batch 功能，将所有查询合并为一个子请求发送
        const statements = items.map(it =>
            db.prepare(querySql).bind(it.code, it.type, days)
        );

        // D1 batch 返回的是 D1Result 数组
        const batchResults = await db.batch(statements);

        items.forEach((it, index) => {
            const key = `${it.type}:${it.code}`;
            const rows = batchResults[index].results || [];
            if (rows.length > 0) {
                result[key] = rows;
            }
        });
    } catch (e) {
        console.error(`[HistoryRepo] getBulkHistory batch failed:`, e.message);
    }

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
/**
 * 股票历史数据全量刷新事务 (Cron 专用)
 * 先删除旧数据，再批量插入 250 条
 */
export async function refreshStockHistoryTransaction(code, historyData) {
    if (!historyData || historyData.length === 0) return;
    const db = await getD1Storage();
    if (!db) return;

    try {
        const statements = [
            db.prepare('DELETE FROM asset_history WHERE code = ? AND type = "stock"').bind(code)
        ];

        // 插入最新的 250 条
        for (const h of historyData.slice(-250)) {
            statements.push(
                db.prepare('INSERT INTO asset_history (code, type, price, record_date) VALUES (?, "stock", ?, ?)')
                    .bind(code, h.value, h.date)
            );
        }

        // 分片执行批量任务
        const CHUNK_SIZE = 100;
        for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
            const chunk = statements.slice(i, i + CHUNK_SIZE);
            await db.batch(chunk);
        }
    } catch (e) {
        console.error(`[HistoryRepo] refreshStockHistoryTransaction failed for ${code}:`, e.message);
    }
}

/**
 * 基金历史数据增量更新事务 (Cron 专用)
 * 检查最新日期并追加，然后修剪至 250 天
 */
export async function incrementalUpdateFundHistory(code, newRecords) {
    if (!newRecords || newRecords.length === 0) return;
    const db = await getD1Storage();
    if (!db) return;

    try {
        const statements = newRecords.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, "fund", ?, ?)')
                .bind(code, r.value, r.date)
        );

        // 分片执行插入
        for (let i = 0; i < statements.length; i += 100) {
            await db.batch(statements.slice(i, i + 100));
        }

        // 保持 250 天：删除该基金 250 天前的所有历史
        await runSql(`
            DELETE FROM asset_history 
            WHERE code = ? AND type = 'fund' 
            AND record_date NOT IN (
                SELECT record_date FROM asset_history 
                WHERE code = ? AND type = 'fund' 
                ORDER BY record_date DESC LIMIT 250
            )
        `, [code, code]);

    } catch (e) {
        console.error(`[HistoryRepo] incrementalUpdateFundHistory failed for ${code}:`, e.message);
    }
}
