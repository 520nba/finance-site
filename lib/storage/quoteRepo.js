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

    // 3. 持久化到 D1 (实施物理写限流保护)
    if (db) {
        const WRITE_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟同步一次 D1

        try {
            // 获取 D1 现有记录以进行时间对比 (防止 Worker 重启/冷启动导致限流失效)
            const dbQuotes = await getBulkQuotes(entries.map(([code]) => code), env);
            const statements = [];

            for (const [code, q] of entries) {
                const lowerCode = code.toLowerCase();
                const dbRecord = dbQuotes[lowerCode];

                // 写入依据：D1 库中无对应记录 OR 距离上次物理写入已超过 30 分钟
                const lastWriteTs = dbRecord?.updated_at ? new Date(dbRecord.updated_at).getTime() : 0;

                if (now - lastWriteTs >= WRITE_INTERVAL_MS) {
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
                }
            }

            if (statements.length > 0) {
                // 分片执行批量持久化
                const CHUNK_SIZE = 50;
                for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
                    await db.batch(statements.slice(i, i + CHUNK_SIZE));
                }
                console.log(`[QuoteRepo] D1 persistent write: ${statements.length}/${entries.length} (30m throttled)`);
            }
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
