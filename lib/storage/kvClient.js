export const memoryCache = new Map();

export async function getKvStorage() {
    // 1. 尝试从全局 process.env 直接获取 (兼容某些 Mock 环境)
    if (typeof process !== 'undefined' && process.env?.STOCK_DATA) {
        return process.env.STOCK_DATA;
    }

    // 2. 尝试从 OpenNext 注入的 Context 获取
    try {
        // 使用 try/catch 保护，避免在非 Edge 环境下触发 bundler 对 @opennextjs/cloudflare 的深度搜索
        const openNext = await import("@opennextjs/cloudflare");
        if (openNext?.getCloudflareContext) {
            const ctx = await openNext.getCloudflareContext();
            if (ctx?.env?.STOCK_DATA) return ctx.env.STOCK_DATA;
        }
    } catch (e) { }

    // 方案 2: 直接尝试全局 process.env (兼容某些构建环境)
    try {
        if (typeof process !== 'undefined' && process.env?.STOCK_DATA) {
            return process.env.STOCK_DATA;
        }
    } catch (e) { }

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
