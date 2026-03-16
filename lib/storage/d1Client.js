export async function getD1Storage(env = null) {
    if (env?.DB) return env.DB;
    try {
        const openNext = await import("@opennextjs/cloudflare");
        const ctx = await openNext.getCloudflareContext();
        return ctx?.env?.DB || null;
    } catch (e) {
        return null;
    }
}

/**
 * 确保 DB 绑定存在
 */
export async function getRequiredDb(env = null) {
    const db = await getD1Storage(env);
    if (!db) {
        throw new Error('D1_BINDING_MISSING: Database binding "DB" is not available.');
    }
    return db;
}

/**
 * 执行简单 SQL (用于 INSERT/UPDATE/DELETE)
 */
export async function runSql(sql, params = [], env = null) {
    const db = await getRequiredDb(env);
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
export async function queryOne(sql, params = [], env = null) {
    const db = await getRequiredDb(env);
    try {
        return await db.prepare(sql).bind(...params).first();
    } catch (e) {
        console.error(`[D1Client] queryOne failed: ${e.message}`, { sql, params });
        throw e;
    }
}

/**
 * 查询多行
 */
export async function queryAll(sql, params = [], env = null) {
    const db = await getRequiredDb(env);
    try {
        const { results } = await db.prepare(sql).bind(...params).all();
        return results || [];
    } catch (e) {
        console.error(`[D1Client] queryAll failed: ${e.message}`, { sql, params });
        throw e;
    }
}

/**
 * 批量执行 SQLs
 */
export async function batchSql(statements, env = null) {
    const db = await getRequiredDb(env);
    try {
        return await db.batch(statements);
    } catch (e) {
        console.error(`[D1Client] batchSql failed: ${e.message}`);
        throw e;
    }
}
