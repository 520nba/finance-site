import { queryOne, queryAll, runSql, getD1Storage } from './d1Client';

/**
 * 获取用户的资产列表
 */
export async function getUserAssets(userId) {
    if (!userId) return [];
    try {
        const sql = 'SELECT code, type FROM user_assets WHERE user_id = ? ORDER BY added_at ASC';
        return await queryAll(sql, [userId]);
    } catch (e) {
        console.error(`[UserRepo] getUserAssets failed for ${userId}:`, e.message);
        return [];
    }
}

/**
 * 更新用户的资产列表 (全量覆盖模式，对齐原有 KV 行为)
 */
export async function saveUserAssets(userId, assets) {
    if (!userId) return false;

    const db = await getD1Storage();
    if (!db) return false;

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
        return true;
    } catch (e) {
        console.error(`[UserRepo] saveUserAssets failed for ${userId}:`, e.message);
        throw e;
    }
}

/**
 * 获取去重后的所有用户资产 (用于 Cron 全量同步)
 */
export async function getGlobalUniqueAssets() {
    try {
        return await queryAll('SELECT DISTINCT code, type FROM user_assets');
    } catch (e) {
        console.error('[UserRepo] getGlobalUniqueAssets failed:', e.message);
        return [];
    }
}

/**
 * 获取所有活跃用户 ID (用于 Cron 任务)
 */
export async function getAllUserIds() {
    try {
        const rows = await queryAll('SELECT id FROM users');
        return rows.map(r => r.id);
    } catch (e) {
        console.error('[UserRepo] getAllUserIds failed:', e.message);
        return [];
    }
}

/**
 * 删除用户及其资产
 */
export async function deleteUser(userId) {
    if (!userId) return false;
    const db = await getD1Storage();
    if (!db) return false;

    try {
        await db.batch([
            db.prepare('DELETE FROM user_assets WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM users WHERE id = ?').bind(userId)
        ]);
        return true;
    } catch (e) {
        console.error(`[UserRepo] deleteUser failed for ${userId}:`, e.message);
        return false;
    }
}
