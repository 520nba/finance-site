import { queryAll, runSql, getD1Storage } from './d1Client';
import { memoryCache } from './memoryCache';
import { chunkArray } from '../utils';

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

    // 2. 查 D1 数据库 (优化为按 code 批量 IN 查询 + Worker 端过滤)
    const groups = chunkArray(toQuery, 40);

    for (const group of groups) {
        try {
            const codes = [...new Set(group.map(it => it.code))];
            const placeholders = codes.map(() => '?').join(',');
            // 使用简化的 IN 语句，减少 SQL 解析复杂度，规避 D1 Parser 长度限制
            const sql = `SELECT code, type, name FROM asset_names WHERE code IN (${placeholders})`;
            const rows = await queryAll(sql, codes);

            // 构建当前批次的查找 Map
            const batchMap = new Map();
            for (const row of rows) {
                batchMap.set(`${row.type}:${row.code}`, row.name);
            }

            // 过滤并精准匹配请求的类型
            for (const it of group) {
                const key = `${it.type}:${it.code}`;
                const name = batchMap.get(key);
                if (name) {
                    result[key] = name;
                    // 2. 回填内存，直接使用 memoryCache 内置 TTL
                    memoryCache.set(NAMES_KEY_PREFIX + key, name, CACHE_TTL); // Simplified cache TTL
                }
            }
        } catch (e) {
            console.error('[NameRepo] getAssetNames chunk failed:', e.message);
        }
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
