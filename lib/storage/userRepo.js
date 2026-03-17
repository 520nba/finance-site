import { queryOne, queryAll, getRequiredDb } from './d1Client';
import { memoryCache } from './memoryCache';

const ASSETS_CACHE_PREFIX = 'user:assets:';
const CACHE_TTL = 300000; // 5 分钟缓存

/**
 * 获取用户的资产列表
 * @param {string} userId
 * @param {Object} env
 */
export async function getUserAssets(userId, env = null) {
    if (!userId) return [];

    // 1. 优先查内存缓存
    const cacheKey = ASSETS_CACHE_PREFIX + userId;
    const cached = memoryCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const sql = 'SELECT code, type FROM user_assets WHERE user_id = ? ORDER BY added_at ASC';
    const assets = await queryAll(sql, [userId], env);

    // 2. 回填内存，直接利用 memoryCache 内置 TTL
    memoryCache.set(cacheKey, assets, CACHE_TTL);

    return assets;
}

/**
 * 检查用户是否在 D1 中存在
 * @param {string} userId
 * @param {Object} env
 */
export async function checkUserExists(userId, env = null) {
    if (!userId) return false;
    try {
        const row = await queryOne('SELECT 1 FROM users WHERE id = ? LIMIT 1', [userId], env);
        return !!row;
    } catch (e) {
        console.error(`[UserRepo] checkUserExists failed for ${userId}:`, e.message);
        return false;
    }
}

/**
 * 更新用户的资产列表 (全量覆盖模式，对齐原有 D1 行为)
 * @param {string} userId
 * @param {Array} assets
 * @param {Object} env
 */
export async function saveUserAssets(userId, assets, env = null) {
    if (!userId) return false;

    const db = await getRequiredDb(env);

    try {
        // 1. 优先独立更新用户最后登录时间 (非核心，允许失败或不在事务内)
        await db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(userId).run();

        // 2. 这里的原子性至关重要：DELETE 和 INSERT 必须在同一个 Batch 中以确保资产列表不被截断
        // 对于资产数量较多的情况，我们将逻辑拆分为：
        // 一个包含 DELETE 和前 N 个 INSERT 的 Batch，以及后续的 INSERT Batch（如果有）
        // 但为了极致安全性，我们建议用户的资产通常在 100 个以内，这样一个 Batch 就能搞定。

        const deleteStmt = db.prepare('DELETE FROM user_assets WHERE user_id = ?').bind(userId);
        const insertStmts = assets.map(a =>
            db.prepare('INSERT INTO user_assets (user_id, code, type) VALUES (?, ?, ?)')
                .bind(userId, a.code.toLowerCase(), a.type)
        );

        // 如果总语句数在 D1 限制内 (通常为 100)，一次性完成以确保绝对原子性
        if (insertStmts.length + 1 <= 100) {
            await db.batch([deleteStmt, ...insertStmts]);
        } else {
            // 超出限制时，第一片包含 DELETE 确保起始一致性，后续片追加
            // 警告：如果后续片失败，资产列表会是不完整的，但至少 DELETE 已经和首片绑定
            const chunks = [];
            let currentChunk = [deleteStmt];

            for (const stmt of insertStmts) {
                currentChunk.push(stmt);
                if (currentChunk.length === 100) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                }
            }
            if (currentChunk.length > 0) chunks.push(currentChunk);

            for (const chunk of chunks) {
                await db.batch(chunk);
            }
        }

        memoryCache.delete(ASSETS_CACHE_PREFIX + userId);
        console.log(`[UserRepo] saveUserAssets success for ${userId}, items: ${assets.length}`);
        return true;
    } catch (e) {
        console.error(`[UserRepo] saveUserAssets CRITICAL FAILED for ${userId}:`, e.message);
        throw e;
    }
}

/**
 * 获取去重后的所有用户资产 (用于 Cron 全量同步)
 * @param {Object} env
 */
export async function getGlobalUniqueAssets(env = null) {
    return await queryAll('SELECT DISTINCT code, type FROM user_assets', [], env);
}

/**
 * 获取所有活跃用户 ID (用于 Cron 任务)
 * @param {Object} env
 */
export async function getAllUserIds(env = null) {
    const rows = await queryAll('SELECT id FROM users', [], env);
    return rows.map(r => r.id);
}

/**
 * 删除用户及其资产
 * @param {string} userId
 * @param {Object} env
 */
export async function deleteUser(userId, env = null) {
    if (!userId) return false;
    const db = await getRequiredDb(env);

    try {
        await db.batch([
            db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM user_assets WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM users WHERE id = ?').bind(userId)
        ]);

        // 联动清理：立刻触发僵尸数据洗消（防止删除用户后行情历史残留）
        const { purgeZombieAssets } = await import('./maintenanceRepo');
        await purgeZombieAssets(env);

        // 维度 3 优化: 更新计数器
        const { decrementCounter } = await import('./statsRepo');
        await decrementCounter('users', 1, env);

        return true;
    } catch (e) {
        console.error(`[UserRepo] deleteUser failed for ${userId}:`, e.message);
        return false;
    }
}
