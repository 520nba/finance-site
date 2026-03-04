import { memoryCache, getKvStorage } from './kvClient';

/**
 * 将批量报价写入 KV（含 2 分钟 TTL）和内存缓存
 * 修复前：只写 memoryCache，Worker 重启后数据全部丢失
 * 修复后：先写 KV 持久化，再更新内存缓存作为二级缓存
 */
export async function saveQuotesToKV(quotesMap) {
    const timeStr = new Date().toISOString();
    const kv = await getKvStorage();

    const writePromises = Object.entries(quotesMap).map(async ([code, q]) => {
        const val = { ...q, updated_at: timeStr };
        const key = `quote:${code}`;
        // 内存缓存（同请求级别快速命中）
        memoryCache.set(key, val);
        // KV 持久化（跨 Worker 实例，TTL=2 分钟防止 KV 积累过期 quote 数据）
        if (kv) {
            try {
                await kv.put(key, JSON.stringify(val), { expirationTtl: 120 });
            } catch (e) {
                console.warn(`[QuoteRepo] KV write failed for ${code}:`, e?.message);
            }
        }
    });

    await Promise.all(writePromises);
}

export async function getBulkQuotesFromKV(codes) {
    const kv = await getKvStorage();
    const result = {};

    const promises = codes.map(async (code) => {
        const key = `quote:${code}`;
        const cached = memoryCache.get(key);
        if (cached) {
            result[code] = cached;
            return;
        }
        if (kv) {
            try {
                const data = await kv.get(key);
                if (data) result[code] = JSON.parse(data);
            } catch (e) { }
        }
    });

    await Promise.all(promises);
    return result;
}
