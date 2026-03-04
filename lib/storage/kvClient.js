// ⚠️ 作用域说明：此 Map 在 Cloudflare Workers 生产环境中仅在 单请求生命周期 内有效。
// 原因：Cloudflare Workers 每个 HTTP 请求运行在独立的 V8 Isolate Context 中，
// 内存状态无法跨请求共享。
// 用途：① 在本地 Dev 环境 (npm run dev) 中作为 KV 的完整内存替代品；
//       ② 在同一请求内防止对相同 Key 的重复 KV 读操作。
export const memoryCache = new Map();

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
    } catch (e) { }

    // 本地 Dev 兜底：返回 null，调用方降级至 memoryCache
    return null;
}

export async function readDoc(key, defaultValue = {}) {
    const kv = await getKvStorage();
    if (kv) {
        try {
            const data = await kv.get(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) { }
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
        } catch (e) { }
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
        } catch (e) { }
    }
    memoryCache.delete(key);
    return true;
}
