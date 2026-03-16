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

    // 1. 成本优化: 仅从内存获取旧报价作为写入频率控制基准
    //    冷启动时 oldQuotes 为空，所有报价将触发一次初始化写入，
    //    以此避免 Worker 冷启动带来的 D1 读取惩罚 (O(N) Read 降为 0)。
    const oldQuotes = {};
    for (const code of Object.keys(quotesMap)) {
        const cached = memoryCache.get(`quote:${code.toLowerCase()}`);
        if (cached) oldQuotes[code.toLowerCase()] = cached;
    }
    const now = Date.now();

    // 2. 无条件更新内存缓存 (确保 L1 永远是最新的)
    for (const [code, q] of entries) {
        const lowerCode = code.toLowerCase();
        memoryCache.set(`quote:${lowerCode}`, { ...q, updated_at: timeStr, code: lowerCode });
    }

    // 3. 持久化到 D1 (实施写限流保护)
    if (db) {
        try {
            const statements = [];
            for (const [code, q] of entries) {
                const lowerCode = code.toLowerCase();
                const old = oldQuotes[lowerCode];

                // 2. 只有当价格变动 > 0.1% 或 距离上次写入超过 10 分钟时，才写入 D1
                const priceChanged = !old || Math.abs((q.price - old.price) / (old.price || 1)) > 0.001;
                const timePassed = !old || (now - new Date(old.updated_at).getTime() > 600000);

                if (priceChanged || timePassed) {
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
                // 分片执行批量任务
                const CHUNK_SIZE = 50;
                for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
                    const chunk = statements.slice(i, i + CHUNK_SIZE);
                    await db.batch(chunk);
                }
                console.log(`[QuoteRepo] Persisted ${statements.length}/${entries.length} quotes to D1 (throtteled)`);
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
        const sql = `SELECT * FROM asset_quotes WHERE code IN (${toQuery.map(() => '?').join(',')})`;
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
