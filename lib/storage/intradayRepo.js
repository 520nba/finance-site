import { memoryCache, getKvStorage, readDoc } from './kvClient';

export async function getIntradayFromKV(code, date, fallbackToLatest = false) {
    const key = `intra:${code}:${date}`;
    let data = await readDoc(key, null);

    if (!data && fallbackToLatest) {
        const kv = await getKvStorage();
        if (kv) {
            for (let i = 1; i <= 3; i++) {
                const prevDate = new Date(new Date(date).getTime() - i * 86400000).toISOString().split('T')[0];
                data = await readDoc(`intra:${code}:${prevDate}`, null);
                if (data) break;
            }
        }
    }
    return data;
}

export async function saveIntradayToKV(code, date, data) {
    const key = `intra:${code}:${date}`;
    const kv = await getKvStorage();
    try {
        const bjTime = new Date(Date.now() + (8 * 3600 * 1000));
        const timeValue = bjTime.getUTCHours() * 100 + bjTime.getUTCMinutes();
        const isMarketClosed = timeValue >= 1515 || timeValue < 900;

        if (kv && isMarketClosed) {
            await kv.put(key, JSON.stringify(data), { expirationTtl: 7 * 24 * 3600 });
        } else {
            memoryCache.set(key, data);
        }
    } catch (e) {
        console.error(`[Storage] Failed to save intraday for ${code}:`, e.message);
    }
}

export async function getBulkIntradayFromKV(items, date) {
    const kv = await getKvStorage();
    const result = {};
    const promises = items.map(async (it) => {
        const key = `intra:${it.code}:${date}`;
        if (kv) {
            const data = await kv.get(key);
            if (data) result[it.code] = JSON.parse(data);
        } else {
            const data = memoryCache.get(key);
            if (data) result[it.code] = data;
        }
    });

    await Promise.all(promises);
    return result;
}
