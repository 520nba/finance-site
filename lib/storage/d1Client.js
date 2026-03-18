// ✅ 只缓存稳定的 env 绑定（不缓存 ctx，因为 ctx 是请求级别的）
let _envCache = null;

async function _getEnv() {
    if (_envCache) return _envCache;
    try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        const { env } = await getCloudflareContext();
        _envCache = env;
        return env;
    } catch {
        return null;
    }
}

/**
 * 统合获取 Cloudflare 上下文 (用于访问 env.API_KEY 或 ctx.waitUntil)
 * 注意：ctx 具有请求生命周期，不可在模块级缓存
 */
export async function getCloudflareCtx() {
    try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        return await getCloudflareContext(); // 返回当前请求的新鲜上下文
    } catch {
        return null;
    }
}

/**
 * 获取 D1 绑定，优先使用显式注入的 env，其次尝试环境上下文单例
 */
export async function getD1Storage(env = null) {
    if (env?.DB) return env.DB;

    // 尝试从本地缓存或 Cloudflare 环境获取
    const cachedEnv = await _getEnv();
    if (cachedEnv?.DB) return cachedEnv.DB;

    // 回退：尝试兼容容器化环境下的 JSON 绑定
    const jsonBinding = process.env.__NEXT_D1_BINDING;
    if (jsonBinding) {
        try {
            return JSON.parse(jsonBinding);
        } catch {
            return null;
        }
    }

    return null;
}

/**
 * 获取 KV 绑定，逻辑与 D1 类似
 */
export async function getKvStorage(kvName, env = null) {
    if (env?.[kvName]) return env[kvName];
    const ctx = await getCloudflareCtx();
    const kv = ctx?.env?.[kvName];
    return kv || null;
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
        e.d1Source = 'runSql'; // 溯源标记
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
        e.d1Source = 'queryOne'; // 溯源标记
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
        e.d1Source = 'queryAll'; // 溯源标记
        console.error(`[D1Client] queryAll failed: ${e.message}`, { sql, params });
        throw e;
    }
}

/**
 * 批量执行 SQLs
 */
export async function batchSql(statements, env = null) {
    const db = await getRequiredDb(env);
    const CHUNK = 100;
    const allResults = [];
    try {
        for (let i = 0; i < statements.length; i += CHUNK) {
            const chunk = statements.slice(i, i + CHUNK);
            const batchResult = await db.batch(chunk);
            allResults.push(...batchResult);
        }
        return allResults;
    } catch (e) {
        e.d1Source = 'batchSql'; // 溯源标记
        console.error(`[D1Client] batchSql failed: ${e.message}`);
        throw e;
    }
}
