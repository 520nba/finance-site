/**
 * 全局内存缓存（L1 Cache）
 * 独立于 KV 存储，供 nameRepo、quoteRepo、maintenanceRepo 等共享使用。
 * Cloudflare Workers 同一 isolate 内的请求可共享此缓存。
 */
export const memoryCache = new Map();
