/**
 * D1 数据库读写封装
 * 提供统一的数据库访问接口，支持本地与 Edge Runtime 环境。
 */

export async function getCloudflareCtx() {
    try {
        const openNext = await import("@opennextjs/cloudflare");
        if (openNext?.getCloudflareContext) {
            return await openNext.getCloudflareContext();
        }
    } catch (e) {
        console.error('[D1Client] Fail obtaining Cloudflare Context:', e.message);
    }
    return null;
}

export async function getD1Storage() {
    const ctx = await getCloudflareCtx();
    return ctx?.env?.DB || null;
}

/**
 * 确保 DB 绑定存在，否则抛出异常以便通过 500/503 暴露问题
 */
export async function getRequiredDb() {
    const db = await getD1Storage();
    if (!db) {
        throw new Error('D1_BINDING_MISSING: Database binding "DB" is not available in current context.');
    }
    return db;
}

/**
 * 执行简单 SQL (用于 INSERT/UPDATE/DELETE)
 */
export async function runSql(sql, params = []) {
    const db = await getRequiredDb();
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
    const db = await getRequiredDb();
    try {
        const result = await db.prepare(sql).bind(...params).first();
        return result;
    } catch (e) {
        console.error(`[D1Client] queryOne failed: ${e.message}`, { sql, params });
        throw e;
    }
}

/**
 * 查询多行
 */
export async function queryAll(sql, params = []) {
    const db = await getRequiredDb();
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
export async function batchSql(statements) {
    const db = await getRequiredDb();
    try {
        // statements 应为 db.prepare(...) 返回的对象数组
        return await db.batch(statements);
    } catch (e) {
        console.error(`[D1Client] batchSql failed: ${e.message}`);
        throw e;
    }
}
