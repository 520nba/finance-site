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
 * D1 下此操作非常高效，不再需要遍历整个命名空间
 * @param {Object} env
 */
export async function purgeZombieAssets(env = null) {
    const db = await getD1Storage(env);
    if (!db) return { success: false, reason: 'D1 unavailable' };

    try {
        const results = {
            deleted_hist: 0,
            deleted_names: 0,
            deleted_quotes: 0,
            deleted_intra: 0
        };

        // 1. 清理历史数据记录 (优化算子：避免 NOT EXISTS 对数万行做子查询)
        const resHist = await db.prepare(`
            DELETE FROM asset_history 
            WHERE code NOT IN (SELECT DISTINCT code FROM user_assets)
        `).run();
        results.deleted_hist = resHist.meta.changes || 0;

        // 2. 清理资产名称
        const resNames = await db.prepare(`
            DELETE FROM asset_names 
            WHERE code NOT IN (SELECT DISTINCT code FROM user_assets)
        `).run();
        results.deleted_names = resNames.meta.changes || 0;

        // 3. 清理分时数据
        const resIntra = await db.prepare(`
            DELETE FROM asset_intraday 
            WHERE code NOT IN (SELECT DISTINCT code FROM user_assets)
        `).run();
        results.deleted_intra = resIntra.meta.changes || 0;

        // 4. 清理报价缓存
        const resQuotes = await db.prepare(`
            DELETE FROM asset_quotes 
            WHERE code NOT IN (SELECT DISTINCT code FROM user_assets)
        `).run();
        results.deleted_quotes = resQuotes.meta.changes || 0;

        console.log(`[Purge] D1 Zombie Cleanup finished: ${JSON.stringify(results)}`);
        return { success: true, ...results };
    } catch (e) {
        console.error('[Purge] SQL Cleanup error:', e.message);
        return { success: false, error: e.message };
    }
}
