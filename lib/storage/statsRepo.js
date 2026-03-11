import { runSql, queryOne } from './d1Client';

/**
 * 维度 3 优化: 计数器模式 (Counter Pattern)
 * 用于将 O(N) 的 COUNT(*) 统计降为 O(1) 的点查询
 */

/**
 * 增加计数
 */
export async function incrementCounter(key, delta = 1) {
    try {
        await runSql(
            `INSERT INTO system_stats (key, value) VALUES (?, ?) 
             ON CONFLICT(key) DO UPDATE SET value = value + ?, updated_at = CURRENT_TIMESTAMP`,
            [key, delta, delta]
        );
    } catch (e) {
        console.error(`[StatsRepo] Failed to increment ${key}:`, e.message);
    }
}

/**
 * 减少计数
 */
export async function decrementCounter(key, delta = 1) {
    try {
        await runSql(
            `UPDATE system_stats SET value = MAX(0, value - ?), updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
            [delta, key]
        );
    } catch (e) {
        console.error(`[StatsRepo] Failed to decrement ${key}:`, e.message);
    }
}

/**
 * 获取计数
 */
export async function getCounter(key) {
    try {
        const row = await queryOne('SELECT value FROM system_stats WHERE key = ?', [key]);
        return row?.value || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 批量获取计数
 */
export async function getCounters(keys) {
    const result = {};
    for (const key of keys) {
        result[key] = await getCounter(key);
    }
    return result;
}

/**
 * 全量修正计数 (昂贵操作，仅在初始化或检测到偏差时运行)
 */
export async function syncCounterFromTable(key, table, where = '') {
    try {
        const sql = `SELECT COUNT(*) as count FROM ${table} ${where ? 'WHERE ' + where : ''}`;
        const row = await queryOne(sql);
        const count = row?.count || 0;
        await runSql(
            `INSERT OR REPLACE INTO system_stats (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [key, count]
        );
        return count;
    } catch (e) {
        console.error(`[StatsRepo] Sync failed for ${key}:`, e.message);
        return 0;
    }
}
