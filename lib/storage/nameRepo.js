import { queryAll, getD1Storage } from './d1Client';
import { memoryCache } from './memoryCache';

export const NAMES_KEY_PREFIX = 'name:';

/**
 * 从 D1 获取资产名称
 * @param {Array<{type: string, code: string}>} items 
 */
export async function getAssetNames(items) {
    if (!items || items.length === 0) return {};

    const result = {};
    const toQuery = [];

    // 1. 先查内存缓存
    for (const it of items) {
        const key = `${it.type}:${it.code}`;
        const cached = memoryCache.get(NAMES_KEY_PREFIX + key);
        if (cached) {
            result[key] = cached;
        } else {
            toQuery.push(it);
        }
    }

    if (toQuery.length === 0) return result;

    // 2. 查 D1 数据库 (批量 OR 查询)
    try {
        const sql = `SELECT code, type, name FROM asset_names WHERE ${toQuery.map(() => '(code = ? AND type = ?)').join(' OR ')}`;
        const params = toQuery.flatMap(it => [it.code, it.type]);

        const rows = await queryAll(sql, params);
        for (const row of rows) {
            const key = `${row.type}:${row.code}`;
            result[key] = row.name;
            // 回填内存缓存
            memoryCache.set(NAMES_KEY_PREFIX + key, row.name);
        }
    } catch (e) {
        console.error('[NameRepo] getAssetNames failed:', e.message);
    }

    return result;
}

/**
 * 批量保存资产名称到 D1（使用 db.batch 一次性写入，替代原来的串行循环）
 * @param {Object} newEntries { "stock:sh600000": "浦发银行" }
 */
export async function saveAssetNames(newEntries) {
    const entries = Object.entries(newEntries);
    if (entries.length === 0) return;

    const db = await getD1Storage();
    if (!db) {
        console.warn('[NameRepo] saveAssetNames: DB unavailable, skipping');
        return;
    }

    try {
        // 使用 db.batch 将 N 次写入压缩为 1 次 D1 往返
        const statements = entries.map(([key, name]) => {
            const [type, code] = key.split(':');
            return db.prepare('INSERT OR REPLACE INTO asset_names (code, type, name, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
                .bind(code, type, name);
        });

        // D1 batch 支持单次最多 100 条，分片执行
        const CHUNK = 100;
        for (let i = 0; i < statements.length; i += CHUNK) {
            await db.batch(statements.slice(i, i + CHUNK));
        }

        // 批量更新内存缓存
        entries.forEach(([key, name]) => memoryCache.set(NAMES_KEY_PREFIX + key, name));
    } catch (e) {
        console.error('[NameRepo] saveAssetNames batch failed:', e.message);
    }
}

/**
 * 从 D1 删除指定资产名称
 */
export async function deleteAssetName(type, code) {
    const key = `${type}:${code}`;
    try {
        await runSql('DELETE FROM asset_names WHERE code = ? AND type = ?', [code, type]);
        memoryCache.delete(NAMES_KEY_PREFIX + key);
    } catch (e) {
        console.error(`[NameRepo] Failed to delete name for ${key}:`, e.message);
    }
}
