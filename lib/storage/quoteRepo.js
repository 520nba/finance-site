import { queryAll, runSql, getD1Storage, batchSql } from './d1Client';
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

    const now = Date.now();

    // 2. 无条件更新内存缓存 (确保 L1 永远是最新的)
    for (const [code, q] of entries) {
        const lowerCode = code.toLowerCase();
        memoryCache.set(`quote:${lowerCode}`, { ...q, updated_at: timeStr, code: lowerCode });
    }

    // 3. 持久化到 D1 (实施写限流保护)
    if (db) {
        const WRITE_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟写一次 D1

        try {
            const statements = [];
            for (const [code, q] of entries) {
                const lowerCode = code.toLowerCase();

                // 读内存里记录的上次 D1 物理写入时间（独立 key）
                const lastD1Write = memoryCache.get(`quote:wts:${lowerCode}`) ?? 0;

                // 写入条件：1. 内存中无记录 (重启/冷启动) 2. 距离上次写入超过 30 分钟
                if (now - lastD1Write >= WRITE_INTERVAL_MS) {
                    statements.push(
                        db.prepare(`
                            INSERT OR REPLACE INTO asset_quotes 
                            (code, name, price, change, changePercent, prevClose, updated_at) 
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            lowerCode,
                            q.name,
                            q.price,
                            q.change,
                            q.changePercent,
                            q.prevClose,
                            timeStr
                        )
                    );
                    // 更新 D1 写入时间戳锁
                    memoryCache.set(`quote:wts:${lowerCode}`, now);
                }
            }

            if (statements.length > 0) {
                // 分片执行批量任务
                const CHUNK_SIZE = 50;
                for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
                    const chunk = statements.slice(i, i + CHUNK_SIZE);
                    await db.batch(chunk);
                }
                console.log(`[QuoteRepo] D1 physical write: ${statements.length}/${entries.length} (30m throttled)`);
            }
        } catch (e) {
            console.warn(`[QuoteRepo] D1 batch insert failed:`, e?.message);
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
