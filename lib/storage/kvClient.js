import { memoryCache } from './memoryCache';
import { getKvStorage as getBaseKv } from './d1Client';

/**
 * 统一获取项目主 KV (STOCK_DATA)
 */
export async function getKvStorage() {
    return await getBaseKv('STOCK_DATA');
}

export async function readDoc(key, defaultValue = {}) {
    const kv = await getKvStorage();
    if (kv) {
        try {
            const data = await kv.get(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) {
            console.error(`[KV:readDoc] Failed to get key "${key}":`, e.message);
        }
    }
    const cached = memoryCache.get(key);
    return cached !== undefined ? cached : defaultValue;
}

export async function writeDoc(key, val) {
    const kv = await getKvStorage();
    const dataStr = typeof val === 'string' ? val : JSON.stringify(val);

    let success = false;
    if (kv) {
        try {
            await kv.put(key, dataStr);
            success = true;
        } catch (e) {
            console.error(`[KV:writeDoc] Failed to put key "${key}":`, e.message);
        }
    }

    // 写入本地缓存作为热备份/降级
    memoryCache.set(key, val);

    // 维度 9 优化：仅在 KV 真正写入成功时返回 true
    // 如果 KV 失败但写入了内存库，也返回 false 提示调用方存在持久化风险
    return success;
}

export async function deleteDoc(key) {
    const kv = await getKvStorage();
    let success = false;

    if (kv) {
        try {
            await kv.delete(key);
            success = true;
        } catch (e) {
            console.error(`[KV:deleteDoc] Failed to delete key "${key}":`, e.message);
        }
    }

    memoryCache.delete(key);
    return success;
}
