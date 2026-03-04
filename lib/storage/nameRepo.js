import { queryAll, runSql } from './d1Client';
import { memoryCache } from './kvClient';

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

    // 2. 查 D1 数据库
    // 构造查询语句，对于 D1，批量查询可以使用 OR 或者 union，或者简单的多条件
    // 此处由于 items 可能较多，采用参数化查询
    try {
        // 为了提高性能，如果待查询项较多，可以使用子查询或复杂的 WHERE 子句
        // 简单方案：由于数量通常不多（~60），可以拼接 SQL 或用 batch
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
 * 保存资产名称到 D1
 * @param {Object} newEntries { "stock:sh600000": "浦发银行" }
 */
export async function saveAssetNames(newEntries) {
    const entries = Object.entries(newEntries);
    if (entries.length === 0) return;

    for (const [key, name] of entries) {
        const [type, code] = key.split(':');
        try {
            // 使用 D1 的 INSERT OR REPLACE
            await runSql(
                'INSERT OR REPLACE INTO asset_names (code, type, name, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [code, type, name]
            );
            // 更新内存缓存
            memoryCache.set(NAMES_KEY_PREFIX + key, name);
        } catch (e) {
            console.error(`[NameRepo] Failed to save name for ${key}:`, e.message);
        }
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
