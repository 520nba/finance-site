import { memoryCache } from './memoryCache';

export async function getKvStorage() {
    // Edge Runtime: KV Namespace 绑定只能通过 getCloudflareContext().env 获取。
    // 注意：process.env.STOCK_DATA 在 Workers 中永远不会是 KV Namespace 对象，
    //       因此移除了原先的 process.env 检查，避免制造无效的代码路径。
    try {
        const openNext = await import("@opennextjs/cloudflare");
        if (openNext?.getCloudflareContext) {
            const ctx = await openNext.getCloudflareContext();
            if (ctx?.env?.STOCK_DATA) return ctx.env.STOCK_DATA;
        }
    } catch (e) {
        console.error('[KV:getKvStorage] Critical context check failed:', e.message);
    }

    // 本地 Dev 兜底：返回 null，调用方降级至 memoryCache
    return null;
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
    if (kv) {
        try {
            await kv.put(key, dataStr);
            return true;
        } catch (e) {
            console.error(`[KV:writeDoc] Failed to put key "${key}":`, e.message);
        }
    }
    memoryCache.set(key, val);
    return true;
}

export async function deleteDoc(key) {
    const kv = await getKvStorage();
    if (kv) {
        try {
            await kv.delete(key);
            return true;
        } catch (e) {
            console.error(`[KV:deleteDoc] Failed to delete key "${key}":`, e.message);
        }
    }
    memoryCache.delete(key);
    return true;
}
