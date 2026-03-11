import { queryAll, runSql, getD1Storage, batchSql } from './d1Client';
import { memoryCache } from './memoryCache';

/**
 * 将批量报价写入 D1 和内存缓存
 */
export async function saveQuotes(quotesMap) {
    const timeStr = new Date().toISOString();
    const db = await getD1Storage();

    const entries = Object.entries(quotesMap);
    if (entries.length === 0) return;

    // 更新内存缓存
    for (const [code, q] of entries) {
        const lowerCode = code.toLowerCase();
        const val = { ...q, updated_at: timeStr, code: lowerCode };
        memoryCache.set(`quote:${lowerCode}`, val);
    }

    // 持久化到 D1
    if (db) {
        try {
            const statements = entries.map(([code, q]) =>
                db.prepare(`
                    INSERT OR REPLACE INTO asset_quotes 
                    (code, name, price, change, changePercent, prevClose, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    code.toLowerCase(),
                    q.name,
                    q.price,
                    q.change,
                    q.changePercent,
                    q.prevClose,
                    timeStr
                )
            );

            // 分片执行批量任务
            const CHUNK_SIZE = 50;
            for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
                const chunk = statements.slice(i, i + CHUNK_SIZE);
                await db.batch(chunk);
            }
        } catch (e) {
            console.warn(`[QuoteRepo] D1 batch insert failed:`, e?.message);
        }
    }
}

/**
 * 批量从 D1 或内存获取报价
 */
export async function getBulkQuotes(codes) {
    if (!codes || codes.length === 0) return {};

    const result = {};
    const toQuery = [];

    // 1. 先查内存缓存
    for (const code of codes) {
        const lowerCode = code.toLowerCase();
        const cached = memoryCache.get(`quote:${lowerCode}`);
        if (cached) {
            result[lowerCode] = cached;
        } else {
            toQuery.push(lowerCode);
        }
    }

    if (toQuery.length === 0) return result;

    // 2. 查 D1 数据库
    try {
        const sql = `SELECT * FROM asset_quotes WHERE LOWER(code) IN (${toQuery.map(() => '?').join(',')})`;
        const rows = await queryAll(sql, toQuery);
        for (const row of rows) {
            result[row.code] = row;
            // 回填内存缓存
            memoryCache.set(`quote:${row.code}`, row);
        }
    } catch (e) {
        console.error('[QuoteRepo] getBulkQuotes failed:', e.message);
    }

    return result;
}
