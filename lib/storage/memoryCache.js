/**
 * 全局内存缓存（L1 Cache）- 增强版
 * 带有容量限制和简单的 TTL 逻辑，防止 128MB 内存溢出
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
