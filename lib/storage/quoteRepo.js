import { queryAll, getD1Storage } from './d1Client';
import { memoryCache } from './memoryCache';

/**
 * 将批量报价写入 D1 和内存缓存
 * @param {Object} quotesMap
 * @param {Object} env
 */
export async function saveQuotes(quotesMap, env = null) {
    const timeStr = new Date().toISOString();
    const db = await getD1Storage(env);
    const entries = Object.entries(quotesMap);
    if (entries.length === 0) return;

    // ✅ 保留：L1 内存缓存，仍然有效（同一 isolate 内去重读）
    for (const [code, q] of entries) {
        const lowerCode = code.toLowerCase();
        memoryCache.set(`quote:${lowerCode}`, { ...q, updated_at: timeStr, code: lowerCode });
    }

    // ✅ D1 条件写入：节流语义下沉到持久层
    if (db) {
        try {
            const statements = entries.map(([code, q]) => {
                const lowerCode = code.toLowerCase();
                return db.prepare(`
                    INSERT INTO asset_quotes
                        (code, name, price, change, changePercent, prevClose, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(code) DO UPDATE SET
                        name         = excluded.name,
                        price        = excluded.price,
                        change       = excluded.change,
                        changePercent = excluded.changePercent,
                        prevClose    = excluded.prevClose,
                        updated_at   = excluded.updated_at
                    WHERE asset_quotes.updated_at IS NULL
                       OR datetime(asset_quotes.updated_at) < datetime('now', '-30 minutes')
                `).bind(
                    lowerCode, q.name, q.price, q.change, q.changePercent, q.prevClose, timeStr
                );
            });

            const CHUNK_SIZE = 50;
            for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
                await db.batch(statements.slice(i, i + CHUNK_SIZE));
            }
            console.log(`[QuoteRepo] D1 conditional upsert: ${statements.length} attempted`);
        } catch (e) {
            console.warn(`[QuoteRepo] D1 batch sync failed:`, e?.message);
        }
    }
}

/**
 * 批量从 D1 或内存获取报价
 * @param {Array} codes
 * @param {Object} env
 */
export async function getBulkQuotes(codes, env = null) {
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
        const sql = `SELECT * FROM asset_quotes WHERE code IN (${toQuery.map(() => '?').join(',')})`;
        const rows = await queryAll(sql, toQuery, env);
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
