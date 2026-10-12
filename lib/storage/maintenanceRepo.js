import { queryOne, runSql, getD1Storage } from './d1Client';

/**
 * 清理指定资产的数据（如果已无用户使用）
 * @param {string} type
 * @param {string} code
 * @param {Object} env
 */
export async function cleanupSingleAssetIfNotUsed(type, code, env = null) {
    try {
        // 在 D1 架构下，JOIN/EXISTS 查询是实时的，移除旧时代的 3s 宽限期延迟
        // 从而实现用户要求的“马上删除”反馈。

        // 检查是否有任何用户仍在使用此资产
        const row = await queryOne(
            'SELECT 1 FROM user_assets WHERE code = ? AND type = ? LIMIT 1',
            [code.toLowerCase(), type],
            env
        );

        if (!row) {
            const db = await getD1Storage(env);
            if (!db) return false;

            // 执行物理清理 (注意 code 统配小写)
            await db.batch([
                db.prepare('DELETE FROM asset_history WHERE code = ? AND type = ?').bind(code.toLowerCase(), type),
                db.prepare('DELETE FROM asset_names WHERE code = ? AND type = ?').bind(code.toLowerCase(), type),
                db.prepare('DELETE FROM asset_intraday WHERE code = ?').bind(code.toLowerCase()),
                db.prepare('DELETE FROM asset_quotes WHERE code = ?').bind(code.toLowerCase())
            ]);

            console.log(`[Cleanup] Auto-purged D1 data for abandoned asset: ${type} ${code}`);
            return true;
        }
    } catch (e) {
        console.error('[Auto Purge] Error:', e.message);
    }
    return false;
}

/**
 * 扫描并清理所有“僵尸”资产 (没有任何用户引用的缓存数据)
 *
 * 实现要点（性能）：不再使用 `DELETE ... WHERE code NOT IN (SELECT ...)`。
 * 那种写法会被 SQLite 计划成 SCAN 目标表 —— 以 asset_intraday 为例，
 * 判断 code 却要读遍 32MB 的 data 页。现在改为：
 *   1. 取在用 code 集合（user_assets，几十行）；
 *   2. 各表用 `SELECT DISTINCT code` 走主键/覆盖索引拿出现过的 code（不读 data 页）；
 *   3. 求差集后按 code 逐条删除（命中主键前缀索引，不扫全表）。
 *
 * @param {Object} env
 */
export async function purgeZombieAssets(env = null) {
    const db = await getD1Storage(env);
    if (!db) return { success: false, reason: 'D1 unavailable' };

    // 表名 → 结果字段名（表名为常量，无注入面）
    const TABLES = [
        ['asset_history', 'deleted_hist'],
        ['asset_names', 'deleted_names'],
        ['asset_intraday', 'deleted_intra'],
        ['asset_quotes', 'deleted_quotes']
    ];

    try {
        const results = { deleted_hist: 0, deleted_names: 0, deleted_quotes: 0, deleted_intra: 0 };

        // 1. 在用资产集合
        const activeRes = await db.prepare('SELECT DISTINCT code FROM user_assets').all();
        const active = new Set((activeRes?.results || []).map(r => r.code));

        // 安全闸：集合为空（查询异常或真的没有资产）时一律不删
        if (active.size === 0) {
            console.warn('[Purge] user_assets is empty → abort to avoid mass deletion');
            return { success: false, reason: 'user_assets empty, purge aborted', ...results };
        }

        // 2. 收集各表的僵尸 code
        const zombies = new Set();
        for (const [table] of TABLES) {
            const res = await db.prepare(`SELECT DISTINCT code FROM ${table}`).all();
            for (const row of res?.results || []) {
                if (!active.has(row.code)) zombies.add(row.code);
            }
        }

        if (zombies.size === 0) {
            console.log('[Purge] No zombie assets found');
            return { success: true, zombie_codes: 0, ...results };
        }

        // 3. 按 code 精确删除（D1 batch 上限 100，留出余量）
        const stmts = [];
        for (const code of zombies) {
            for (const [table, key] of TABLES) {
                stmts.push({ key, stmt: db.prepare(`DELETE FROM ${table} WHERE code = ?`).bind(code) });
            }
        }

        const CHUNK = 90;
        for (let i = 0; i < stmts.length; i += CHUNK) {
            const chunk = stmts.slice(i, i + CHUNK);
            const batchRes = await db.batch(chunk.map(s => s.stmt));
            chunk.forEach((s, idx) => {
                results[s.key] += batchRes?.[idx]?.meta?.changes || 0;
            });
        }

        console.log(`[Purge] D1 Zombie Cleanup finished: codes=${zombies.size} ${JSON.stringify(results)}`);
        return { success: true, zombie_codes: zombies.size, ...results };
    } catch (e) {
        console.error('[Purge] SQL Cleanup error:', e.message);
        return { success: false, error: e.message };
    }
}
