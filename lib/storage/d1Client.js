/**
 * D1 数据库读写封装
 * 提供统一的数据库访问接口，支持本地与 Edge Runtime 环境。
 */

export async function getD1Storage() {
    try {
        const openNext = await import("@opennextjs/cloudflare");
        if (openNext?.getCloudflareContext) {
            const ctx = await openNext.getCloudflareContext();
            // 在 wrangler.jsonc 中定义的绑定名称是 DB
            if (ctx?.env?.DB) return ctx.env.DB;
        }
    } catch (e) {
        console.error('[D1Client] Failed to get D1 context:', e.message);
    }

    // 生产环境下如果不返回 DB 则可能导致失败，
    // 本地开发环境下 OpenNext 会模拟环境
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
        return null;
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
        return [];
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
