/**
 * 统一存储抽象层
 * 
 * 生产环境 (Cloudflare Edge)：使用 KV (如果绑定了 STOCK_KV)，否则内存缓存
 * 本地开发 (Node.js)：使用内存缓存（数据不持久化，重启即失效）
 * 
 * 注意：此文件不包含任何 Node.js 专有模块引用 (fs, path)，
 * 以确保 @cloudflare/next-on-pages 打包时不会因静态分析而崩溃。
 */

// 内存缓存 fallback（本地开发 + 未绑定 KV 的 Edge 环境）
const memoryCache = new Map();

function getKvStorage() {
    try { if (typeof STOCK_KV !== 'undefined') return STOCK_KV; } catch { }
    try { if (globalThis?.STOCK_KV) return globalThis.STOCK_KV; } catch { }
    return null;
}

export async function readDoc(key, defaultValue = {}) {
    // 1. 尝试 KV
    const kv = getKvStorage();
    if (kv) {
        try {
            const data = await kv.get(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) { }
    }
    // 2. 内存缓存
    const cached = memoryCache.get(key);
    return cached !== undefined ? cached : defaultValue;
}

export async function writeDoc(key, val) {
    // 1. 尝试 KV
    const kv = getKvStorage();
    if (kv) {
        try {
            const dataStr = typeof val === 'string' ? val : JSON.stringify(val);
            await kv.put(key, dataStr);
            return true;
        } catch (e) { }
    }
    // 2. 内存缓存
    memoryCache.set(key, val);
    return true;
}
