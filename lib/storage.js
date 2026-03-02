/**
 * 统一存储抽象层
 * 
 * 生产环境 (Cloudflare Workers)：通过 getCloudflareContext 访问 KV 绑定
 * 本地开发 (Node.js)：使用内存缓存（数据不持久化，重启即失效）
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

// 内存缓存 fallback（本地开发 + 未绑定 KV 的环境）
const memoryCache = new Map();

async function getKvStorage() {
    try {
        const { env } = await getCloudflareContext();
        if (env?.STOCK_DATA) return env.STOCK_DATA;
    } catch { }
    return null;
}

export async function readDoc(key, defaultValue = {}) {
    // 1. 尝试 KV
    const kv = await getKvStorage();
    if (kv) {
        try {
            const data = await kv.get(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) { }
    }
    // 2. 内存缓存
    const cached = memoryCache.get(key);
    return cached !== undefined ? cached : defaultValue;
}

export async function writeDoc(key, val) {
    // 1. 尝试 KV
    const kv = await getKvStorage();
    if (kv) {
        try {
            const dataStr = typeof val === 'string' ? val : JSON.stringify(val);
            await kv.put(key, dataStr);
            return true;
        } catch (e) { }
    }
    // 2. 内存缓存
    memoryCache.set(key, val);
    return true;
}

export async function getHistoryFromDB(code, type, days) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const { results } = await env.DB.prepare(
                `SELECT record_date as date, price as value 
                 FROM asset_history 
                 WHERE code = ? AND type = ? 
                 ORDER BY record_date DESC 
                 LIMIT ?`
            ).bind(code, type, days).all();

            if (results && results.length > 0) {
                return results.reverse();
            }
        }
    } catch (e) {
        console.error(`[DB] Fetch history failed for ${code}:`, e.message);
    }
    return null;
}

export async function getBulkHistoryFromDB(items, days) {
    if (!items || items.length === 0) return {};
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const result = {};
            const stmt = env.DB.prepare(
                `SELECT record_date as date, price as value 
                 FROM asset_history 
                 WHERE code = ? AND type = ? 
                 ORDER BY record_date DESC 
                 LIMIT ?`
            );

            // 使用 D1 Batch 特性一次性发送所有查询，极大降低服务端往返开销
            const CHUNK = 20;
            for (let i = 0; i < items.length; i += CHUNK) {
                const chunk = items.slice(i, i + CHUNK);
                const batchStmts = chunk.map(it => stmt.bind(it.code, it.type, days));
                const batchResults = await env.DB.batch(batchStmts);

                batchResults.forEach((res, idx) => {
                    if (res.results && res.results.length > 0) {
                        const item = chunk[idx];
                        result[`${item.type}:${item.code}`] = res.results.reverse();
                    }
                });
            }
            return result;
        }
    } catch (e) {
        console.error(`[DB] Bulk fetch history failed:`, e.message);
    }
    return {};
}

export async function insertDailyPrice(code, type, price, date) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            await env.DB.prepare(
                `INSERT INTO asset_history (code, type, price, record_date) 
                 VALUES (?, ?, ?, ?) 
                 ON CONFLICT(code, type, record_date) DO UPDATE SET price=excluded.price`
            ).bind(code, type, price, date).run();
        }
    } catch (e) {
        console.error(`[DB] Insert failed for ${code} on ${date}:`, e.message);
    }
}

export async function insertDailyPricesBatch(records) {
    if (!records || records.length === 0) return;
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const stmt = env.DB.prepare(
                `INSERT INTO asset_history (code, type, price, record_date) 
                 VALUES (?, ?, ?, ?) 
                 ON CONFLICT(code, type, record_date) DO UPDATE SET price=excluded.price`
            );
            const batchStmts = records.map(r => stmt.bind(r.code, r.type, r.price, r.date));
            // 分批限制，D1每次batch不宜过大
            for (let i = 0; i < batchStmts.length; i += 100) {
                await env.DB.batch(batchStmts.slice(i, i + 100));
            }
            // 写入大量数据后，顺便进行一次被动清理
            cleanupOldData().catch(() => { });
        }
    } catch (e) {
        console.error(`[DB] Batch insert failed: ${records.length} records.`, e.message);
    }
}

export async function getIntradayFromDB(code, date, fallbackToLatest = false) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            if (date) {
                const result = await env.DB.prepare(
                    `SELECT data, updated_at FROM asset_intraday WHERE code = ? AND record_date = ?`
                ).bind(code, date).first();
                if (result) return { ...JSON.parse(result.data), updated_at: result.updated_at };
            }

            if (fallbackToLatest) {
                const latest = await env.DB.prepare(
                    `SELECT data, updated_at FROM asset_intraday WHERE code = ? ORDER BY record_date DESC LIMIT 1`
                ).bind(code).first();
                if (latest) return { ...JSON.parse(latest.data), updated_at: latest.updated_at };
            }
        }
    } catch (e) { return null; }
    return null;
}

export async function saveIntradayToDB(code, date, data) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const dataStr = JSON.stringify(data);
            await env.DB.prepare(
                `INSERT INTO asset_intraday (code, record_date, data, updated_at) 
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(code, record_date) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`
            ).bind(code, date, dataStr).run();

            // 每次保存分时时，小概率(1/10)触发清理，避免高频操作
            if (Math.random() < 0.1) {
                cleanupOldData().catch(() => { });
            }
        }
    } catch (e) {
        console.error(`[DB] Save intraday failed for ${code}:`, e.message);
    }
}

/**
 * 批量从 DB 获取分时数据 (D1 Batch)
 */
export async function getBulkIntradayFromDB(items, date) {
    if (!items || items.length === 0) return {};
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const result = {};
            const stmt = env.DB.prepare(
                `SELECT code, data, updated_at FROM asset_intraday WHERE code = ? AND record_date = ?`
            );
            const CHUNK = 20;
            for (let i = 0; i < items.length; i += CHUNK) {
                const chunk = items.slice(i, i + CHUNK);
                const batchStmts = chunk.map(it => stmt.bind(it.code, date));
                const batchResults = await env.DB.batch(batchStmts);
                batchResults.forEach((res, idx) => {
                    if (res && res.results && res.results.length > 0) {
                        const row = res.results[0];
                        result[row.code] = { ...JSON.parse(row.data), updated_at: row.updated_at };
                    }
                });
            }
            return result;
        }
    } catch (e) {
        console.error(`[DB] Bulk fetch intraday failed:`, e.name, e.message);
    }
    return {};
}

/**
 * 数据库自动瘦身逻辑
 * 1. 分时数据：只保留当天的
 * 2. 历史数据：保留最近 400 天的，过期删除
 */
export async function cleanupOldData() {
    try {
        const { env } = await getCloudflareContext();
        if (!env?.DB) return;

        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

        // 1. 清理过期的分时数据 (保留最近 2 天的)
        await env.DB.prepare(
            `DELETE FROM asset_intraday 
             WHERE record_date NOT IN (
                SELECT record_date FROM asset_intraday 
                WHERE code = 'SYSTEM_MARKER' OR 1=1 
                GROUP BY record_date 
                ORDER BY record_date DESC 
                LIMIT 2
             )`
        ).run();

        // 2. 清理过期的历史日线 (保留约一年多的数据，计算 400 天前)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 400);
        const cutoffStr = cutoffDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

        await env.DB.prepare(
            `DELETE FROM asset_history WHERE record_date < ?`
        ).bind(cutoffStr).run();

        // 3. 清理不再被任何用户自选的资产数据 (孤立资产清理)
        const userConfig = await readDoc('users_config', {});
        const activeCodes = new Set();
        Object.values(userConfig).forEach(assets => {
            if (Array.isArray(assets)) {
                assets.forEach(a => activeCodes.add(a.code));
            }
        });

        if (activeCodes.size > 0) {
            // 将 Set 转为 SQL 支持的格式
            const placeholders = Array.from(activeCodes).map(() => '?').join(',');
            const codesArray = Array.from(activeCodes);

            // 异步删除不再活跃的历史数据
            await env.DB.prepare(
                `DELETE FROM asset_history WHERE code NOT IN (${placeholders})`
            ).bind(...codesArray).run();

            // 异步删除不再活跃的分时数据
            await env.DB.prepare(
                `DELETE FROM asset_intraday WHERE code NOT IN (${placeholders})`
            ).bind(...codesArray).run();
        }

        // 4. 清理超过 48 小时的系统日志
        await env.DB.prepare(
            `DELETE FROM system_logs WHERE timestamp < datetime('now', '-48 hours')`
        ).run();

    } catch (e) {
        console.error(`[DB Cleanup] failed:`, e.message);
    }
}

/**
 * 添加系统日志
 */
export async function addSystemLog(level, module, message) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            // 记录到终端以备 D1 写入失败
            console.log(`[LOG][${level}][${module}] ${message}`);

            await env.DB.prepare(
                `INSERT INTO system_logs (level, module, message) VALUES (?, ?, ?)`
            ).bind(level, module, message).run();
        }
    } catch (e) {
        // 如果表不存在，这里会抛错，静默处理不影响主流程
    }
}

/**
 * 获取系统日志 (带时间筛选)
 */
export async function getSystemLogs(hours = 48) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const { results } = await env.DB.prepare(
                `SELECT * FROM system_logs 
                 WHERE timestamp > datetime('now', '-${hours} hours') 
                 ORDER BY timestamp DESC`
            ).all();
            return results;
        }
    } catch (e) {
        console.error(`[Log] Failed to fetch logs:`, e.message);
    }
    return [];
}

/**
 * 从 DB 获取批量资产名称
 */
export async function getAssetNamesFromDB(items) {
    if (!items || items.length === 0) return {};
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const result = {};
            // 由于 D1 的限制，我们分批查询以防止参数过多
            const CHUNK = 30;
            for (let i = 0; i < items.length; i += CHUNK) {
                const chunk = items.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '(?, ?)').join(',');
                const values = chunk.flatMap(it => [it.code, it.type]);

                const { results } = await env.DB.prepare(
                    `SELECT code, type, name FROM asset_names WHERE (code, type) IN (${placeholders})`
                ).bind(...values).all();

                if (results) {
                    results.forEach(r => result[`${r.type}:${r.code}`] = r.name);
                }
            }
            return result;
        }
    } catch (e) {
        console.error(`[DB Names] Fetch failed:`, e.message);
    }
    return {};
}

/**
 * 批量保存资产名称到 DB
 */
export async function saveAssetNamesToDB(namesMap) {
    const entries = Object.entries(namesMap);
    if (entries.length === 0) return;
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const stmt = env.DB.prepare(
                `INSERT INTO asset_names (code, type, name, updated_at) 
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(code, type) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at`
            );
            const batchStmts = entries.map(([key, name]) => {
                const [type, code] = key.split(':');
                return stmt.bind(code, type, name);
            });
            await env.DB.batch(batchStmts);
        }
    } catch (e) {
        console.error(`[DB Names] Save failed:`, e.message);
    }
}

/**
 * 批量保存报价到 DB
 */
export async function saveQuotesToDB(quotesMap) {
    const entries = Object.entries(quotesMap);
    if (entries.length === 0) return;
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const stmt = env.DB.prepare(
                `INSERT INTO asset_quotes (code, name, price, change, changePercent, prevClose, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(code) DO UPDATE SET name=excluded.name, price=excluded.price, change=excluded.change, changePercent=excluded.changePercent, prevClose=excluded.prevClose, updated_at=CURRENT_TIMESTAMP`
            );
            const batchStmts = entries.map(([code, q]) => stmt.bind(code, q.name, q.price, q.change, q.changePercent, q.prevClose));
            await env.DB.batch(batchStmts);
        }
    } catch (e) { e; }
}

/**
 * 批量从 DB 获取报价
 */
export async function getBulkQuotesFromDB(codes) {
    if (!codes || codes.length === 0) return {};
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            const result = {};
            const CHUNK = 30;
            for (let i = 0; i < codes.length; i += CHUNK) {
                const chunk = codes.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '?').join(',');
                const { results } = await env.DB.prepare(
                    `SELECT * FROM asset_quotes WHERE code IN (${placeholders})`
                ).bind(...chunk).all();
                if (results) {
                    results.forEach(r => {
                        result[r.code] = {
                            code: r.code, name: r.name, price: r.price,
                            change: r.change, changePercent: r.changePercent, prevClose: r.prevClose, updated_at: r.updated_at
                        };
                    });
                }
            }
            return result;
        }
    } catch (e) { e; }
    return {};
}


/**
 * 彻底删除某个资产的所有物理数据 (被动触发)
 */
export async function deleteAssetData(code) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            await env.DB.batch([
                env.DB.prepare(`DELETE FROM asset_history WHERE code = ?`).bind(code),
                env.DB.prepare(`DELETE FROM asset_intraday WHERE code = ?`).bind(code)
            ]);
        }
    } catch (e) {
        console.error(`[DB] Delete asset data failed for ${code}:`, e.message);
    }
}
