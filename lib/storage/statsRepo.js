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

const ALLOWED_TABLES = new Set([
    'users', 'user_assets', 'asset_history',
    'asset_intraday', 'asset_quotes', 'system_logs', 'sync_jobs', 'asset_names'
]);

/**
 * 全量修正计数 (昂贵操作，仅在初始化或检测到偏差时运行)
 * 安全性：通过白名单与正则过滤防止 SQL 注入
 */
export async function syncCounterFromTable(key, table, where = '', env = null) {
    // 1. 白名单验证，防止表名注入
    if (!ALLOWED_TABLES.has(table)) {
        console.error(`[StatsRepo] Rejected unknown table: "${table}"`);
        return 0;
    }

    // 2. 简单的 Where 子句安全校验 (只允许简单的属性等于值，禁止子查询或复杂逻辑拼接)
    if (where && !/^[\w\.]+ = '[\w\-]+'$/.test(where)) {
        console.error(`[StatsRepo] Rejected unsafe where clause: "${where}"`);
        return 0;
    }

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
 *
 * 原实现是一条 `asset_names LEFT JOIN asset_history` + 每组一个相关子查询：
 * EXPLAIN 显示 SCAN asset_names → 每个 code 拉全部历史（合计 13,000 行）
 * → CORRELATED SCALAR SUBQUERY + TEMP B-TREE（每个 code 一次排序）。
 * 现改为三条各自可控的查询，再在 JS 里按 (code,type) 组装：
 *   1. 历史存量一次 GROUP BY（走 idx_asset_lookup）；
 *   2. 每个 code 的最新任务状态（覆盖索引 + 主键回表）；
 *   3. asset_names 作为主表（几十行），保持返回行集与字段不变。
 */
export async function getAssetSyncStatus(env = null) {
    try {
        const histRows = await queryAll(`
            SELECT code, type, COUNT(*) AS history_count, MAX(created_at) AS last_sync
            FROM asset_history
            GROUP BY code, type
        `, [], env);

        const jobRows = await queryAll(`
            SELECT code, status FROM sync_jobs
            WHERE id IN (SELECT MAX(id) FROM sync_jobs GROUP BY code)
        `, [], env);

        const names = await queryAll(
            'SELECT code, type, name FROM asset_names ORDER BY type ASC, code ASC',
            [],
            env
        );

        const histMap = new Map((histRows || []).map(r => [`${r.code}:${r.type}`, r]));
        const jobMap = new Map((jobRows || []).map(r => [r.code, r.status]));

        return (names || []).map(n => {
            const key = `${n.code}:${n.type}`;
            const hist = histMap.get(key);
            return {
                code: n.code,
                type: n.type,
                name: n.name,
                history_count: hist?.history_count || 0,
                last_sync: hist?.last_sync || null,
                sync_status: jobMap.get(String(n.code).toLowerCase()) || jobMap.get(n.code) || null
            };
        });
    } catch (e) {
        console.error('[StatsRepo] getAssetSyncStatus failed:', e.message);
        return [];
    }
}
