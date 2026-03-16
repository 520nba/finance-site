import { queryOne, queryAll, getRequiredDb } from './d1Client';
import { memoryCache } from './memoryCache';

const ASSETS_CACHE_PREFIX = 'user:assets:';
const CACHE_TTL = 300000; // 5 分钟缓存

/**
 * 获取用户的资产列表
 */
export async function getUserAssets(userId) {
    if (!userId) return [];

    // 1. 优先查内存缓存
    const cacheKey = ASSETS_CACHE_PREFIX + userId;
    const cached = memoryCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const sql = 'SELECT code, type FROM user_assets WHERE user_id = ? ORDER BY added_at ASC';
    const assets = await queryAll(sql, [userId]);

    // 2. 回填内存，直接利用 memoryCache 内置 TTL
    memoryCache.set(cacheKey, assets, CACHE_TTL);

    return assets;
}

/**
 * 检查用户是否在 D1 中存在
 */
export async function checkUserExists(userId) {
    if (!userId) return false;
    try {
        const row = await queryOne('SELECT 1 FROM users WHERE id = ? LIMIT 1', [userId]);
        return !!row;
    } catch (e) {
        console.error(`[UserRepo] checkUserExists failed for ${userId}:`, e.message);
        return false;
    }
}

/**
 * 更新用户的资产列表 (全量覆盖模式，对齐原有 D1 行为)
 */
export async function saveUserAssets(userId, assets) {
    if (!userId) return false;

    const db = await getRequiredDb();

    try {
        // 使用事务确保更新原子性
        const statements = [
            // 1. 确保用户存在
            db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').bind(userId),
            db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(userId),
            // 2. 删除旧资产
            db.prepare('DELETE FROM user_assets WHERE user_id = ?').bind(userId)
        ];

        // 3. 插入新资产
        for (const a of assets) {
            statements.push(
                db.prepare('INSERT INTO user_assets (user_id, code, type) VALUES (?, ?, ?)')
                    .bind(userId, a.code.toLowerCase(), a.type)
            );
        }

        await db.batch(statements);

        // 关键：更新成功后立即清理内存缓存，确保下次读取到最新数据
        memoryCache.delete(ASSETS_CACHE_PREFIX + userId);

        console.log(`[UserRepo] saveUserAssets success for ${userId}, items: ${assets.length}`);
        return true;
    } catch (e) {
        console.error(`[UserRepo] saveUserAssets CRITICAL FAILED for ${userId}:`, e.message);
        console.error(`[UserRepo] SQL Error Details:`, e);
        throw e;
    }
}

/**
 * 获取去重后的所有用户资产 (用于 Cron 全量同步)
 */
export async function getGlobalUniqueAssets() {
    return await queryAll('SELECT DISTINCT code, type FROM user_assets');
}

/**
 * 获取所有活跃用户 ID (用于 Cron 任务)
 */
export async function getAllUserIds() {
    const rows = await queryAll('SELECT id FROM users');
    return rows.map(r => r.id);
}

/**
 * 删除用户及其资产
 */
export async function deleteUser(userId) {
    if (!userId) return false;
    const db = await getRequiredDb();

    try {
        await db.batch([
            db.prepare('DELETE FROM user_assets WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM users WHERE id = ?').bind(userId)
        ]);

        // 维度 3 优化: 更新计数器
        const { decrementCounter } = await import('./statsRepo');
        await decrementCounter('users');

        return true;
    } catch (e) {
        console.error(`[UserRepo] deleteUser failed for ${userId}:`, e.message);
        return false;
    }
}
