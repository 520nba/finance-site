/**
 * 请求级内存缓存（L1）
 *
 * Cloudflare Workers 生产环境：每个 HTTP 请求独立的 V8 Isolate，
 * 内存不跨请求共享，TTL 在生产环境中无实际意义，
 * 主要作用是在同一请求内对相同 key 去重，避免重复 D1 查询。
 *
 * 本地开发环境（Node.js）：内存跨请求共享，TTL 在此环境下真正生效。
 */
class MemoryCache {
    constructor(maxSize = 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    set(key, value, ttlMs = 0) {
        // 容量控制：LRU 基础逻辑（删除最旧的）
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        const entry = {
            value,
            expiry: ttlMs > 0 ? Date.now() + ttlMs : null
        };
        this.cache.set(key, entry);
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // 过期检查
        if (entry.expiry && Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }
}

export const memoryCache = new MemoryCache(1500);
