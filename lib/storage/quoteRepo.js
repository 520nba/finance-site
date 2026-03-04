import { memoryCache, getKvStorage } from './kvClient';

export async function saveQuotesToKV(quotesMap) {
    const timeStr = new Date().toISOString();
    Object.entries(quotesMap).forEach(([code, q]) => {
        const val = { ...q, updated_at: timeStr };
        memoryCache.set(`quote:${code}`, val);
    });
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
