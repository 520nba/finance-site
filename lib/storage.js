/**
 * 统一存储抽象层
 * 
 * 生产环境 (Cloudflare Workers)：通过 getCloudflareContext 访问 KV 绑定
 * 本地开发 (Node.js)：使用内存缓存（数据不持久化，重启即失效）
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

// 内存缓存 fallback（本地开发 + 未绑定 KV 的环境）
const memoryCache = new Map();

async function getKvStorage() {
    try {
        const { env } = await getCloudflareContext();
        if (env?.STOCK_DATA) return env.STOCK_DATA;
    } catch { }
    return null;
}

export async function readDoc(key, defaultValue = {}) {
    // 1. 尝试 KV
    const kv = await getKvStorage();
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
    const kv = await getKvStorage();
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

export async function insertDailyPrice(code, type, price, date) {
    try {
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            await env.DB.prepare(
                `INSERT INTO asset_history (code, type, price, record_date) 
                 VALUES (?, ?, ?, ?) 
                 ON CONFLICT(code, type, record_date) DO UPDATE SET price=excluded.price`
            ).bind(code, type, price, date).run();
        }
    } catch (e) {
        console.error(`[DB] Insert failed for ${code} on ${date}:`, e.message);
    }
}
