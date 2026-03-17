import { runSql, queryOne, queryAll } from './d1Client';

/**
 * 维度 3 优化: 计数器模式 (Counter Pattern)
 * 用于将 O(N) 的 COUNT(*) 统计降为 O(1) 的点查询
 */

/**
 * 增加计数
 */
export async function incrementCounter(key, delta = 1, env = null) {
    try {
        await runSql(
            `INSERT INTO system_stats (key, value) VALUES (?, ?) 
             ON CONFLICT(key) DO UPDATE SET value = value + ?, updated_at = CURRENT_TIMESTAMP`,
            [key, delta, delta],
            env
        );
    } catch (e) {
        console.error(`[StatsRepo] Failed to increment ${key}:`, e.message);
    }
}

/**
 * 减少计数
 */
export async function decrementCounter(key, delta = 1, env = null) {
    try {
        await runSql(
            `UPDATE system_stats SET value = MAX(0, value - ?), updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
            [delta, key],
            env
        );
    } catch (e) {
        console.error(`[StatsRepo] Failed to decrement ${key}:`, e.message);
    }
}

/**
 * 获取计数
 */
export async function getCounter(key, env = null) {
    try {
        const row = await queryOne('SELECT value FROM system_stats WHERE key = ?', [key], env);
        return row?.value || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 批量获取计数 (维度 3 优化: 单次 IN 查询)
 */
export async function getCounters(keys, env = null) {
    if (!keys || keys.length === 0) return {};
    try {
        const placeholders = keys.map(() => '?').join(',');
        const rows = await queryAll(
            `SELECT key, value FROM system_stats WHERE key IN (${placeholders})`,
            keys,
            env
        );
        return Object.fromEntries(rows.map(r => [r.key, r.value]));
    } catch (e) {
        console.error('[StatsRepo] getCounters failed:', e.message);
        return {};
    }
}

/**
 * 全量修正计数 (昂贵操作，仅在初始化或检测到偏差时运行)
 */
export async function syncCounterFromTable(key, table, where = '', env = null) {
    try {
        const sql = `SELECT COUNT(*) as count FROM ${table} ${where ? 'WHERE ' + where : ''}`;
        const row = await queryOne(sql, [], env);
        const count = row?.count || 0;
        await runSql(
            `INSERT OR REPLACE INTO system_stats (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [key, count],
            env
        );
        return count;
    } catch (e) {
        console.error(`[StatsRepo] Sync failed for ${key}:`, e.message);
        return 0;
    }
}

/**
 * 获取所有资产的同步状态与统计信息
 */
export async function getAssetSyncStatus(env = null) {
    try {
        const sql = `
            SELECT 
                an.code, 
                an.type, 
                an.name,
                COUNT(ah.record_date) as history_count,
                MAX(ah.created_at) as last_sync,
                (
                    SELECT status FROM sync_jobs 
                    WHERE code = lower(an.code) 
                    ORDER BY updated_at DESC LIMIT 1
                ) as sync_status
            FROM asset_names an
            LEFT JOIN asset_history ah ON an.code = ah.code AND an.type = ah.type
            GROUP BY an.code, an.type, an.name
            ORDER BY an.type ASC, an.code ASC
        `;
        return await queryAll(sql, [], env);
    } catch (e) {
        console.error('[StatsRepo] getAssetSyncStatus failed:', e.message);
        return [];
    }
}
