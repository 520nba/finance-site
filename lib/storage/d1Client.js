let cachedDb = null;
let cachedCtx = null;

export async function getD1Storage() {
    // 优先使用缓存的实例 (热启动加速)
    if (cachedDb) return cachedDb;

    try {
        const openNext = await import("@opennextjs/cloudflare");
        if (openNext?.getCloudflareContext) {
            // Context 也可以复用
            if (!cachedCtx) {
                cachedCtx = await openNext.getCloudflareContext();
            }

            if (cachedCtx?.env?.DB) {
                cachedDb = cachedCtx.env.DB;
                return cachedDb;
            }
        }
    } catch (e) {
        console.error('[D1Client] Failed to get D1 context or DB binding:', e.message);
    }

    return null;
}

/**
 * 执行简单 SQL (用于 INSERT/UPDATE/DELETE)
 */
export async function runSql(sql, params = []) {
    const db = await getD1Storage();
    if (!db) {
        console.warn('[D1Client] DB unavailable, skipping SQL:', sql);
        return null;
    }
    try {
        return await db.prepare(sql).bind(...params).run();
    } catch (e) {
        console.error(`[D1Client] runSql failed: ${e.message}`, { sql, params });
        throw e;
    }
}

/**
 * 查询单行
 */
export async function queryOne(sql, params = []) {
    const db = await getD1Storage();
    if (!db) return null;
    try {
        return await db.prepare(sql).bind(...params).first();
    } catch (e) {
        console.error(`[D1Client] queryOne failed: ${e.message}`, { sql, params });
        throw e; // 抛出异常以便上层诊断
    }
}

/**
 * 查询多行
 */
export async function queryAll(sql, params = []) {
    const db = await getD1Storage();
    if (!db) return [];
    try {
        const { results } = await db.prepare(sql).bind(...params).all();
        return results || [];
    } catch (e) {
        console.error(`[D1Client] queryAll failed: ${e.message}`, { sql, params });
        throw e; // 抛出异常以便上层诊断
    }
}

/**
 * 批量执行 SQLs
 */
export async function batchSql(statements) {
    const db = await getD1Storage();
    if (!db) return null;
    try {
        // statements 应为 db.prepare(...) 返回的对象数组
        return await db.batch(statements);
    } catch (e) {
        console.error(`[D1Client] batchSql failed: ${e.message}`);
        throw e;
    }
}
