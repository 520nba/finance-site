import { getKvStorage, memoryCache } from './kvClient';

export const NAMES_KEY = 'names:all';

export async function getAssetNamesFromKV(items) {
    const kv = await getKvStorage();

    let namesMap = memoryCache.get(NAMES_KEY);
    if (!namesMap) {
        if (kv) {
            try {
                const raw = await kv.get(NAMES_KEY);
                namesMap = raw ? JSON.parse(raw) : {};
            } catch (e) {
                namesMap = {};
            }
        } else {
            namesMap = {};
        }
        memoryCache.set(NAMES_KEY, namesMap);
    }

    const result = {};
    for (const it of items) {
        const key = `${it.type}:${it.code}`;
        if (namesMap[key]) result[key] = namesMap[key];
    }
    return result;
}

export async function saveAssetNamesToKV(newEntries) {
    const kv = await getKvStorage();

    let namesMap = memoryCache.get(NAMES_KEY) || {};
    Object.assign(namesMap, newEntries);
    memoryCache.set(NAMES_KEY, namesMap);

    if (kv) {
        try {
            await kv.put(NAMES_KEY, JSON.stringify(namesMap));
        } catch (e) {
            console.error('[Storage] Failed to save names map:', e.message);
        }
    }
}

export async function deleteNameFromKV(type, code) {
    const kv = await getKvStorage();
    const key = `${type}:${code}`;
    let namesMap = memoryCache.get(NAMES_KEY) || {};
    if (kv && !namesMap[key]) {
        try { const raw = await kv.get(NAMES_KEY); namesMap = raw ? JSON.parse(raw) : {}; } catch (e) { }
    }
    if (namesMap[key]) {
        delete namesMap[key];
        memoryCache.set(NAMES_KEY, namesMap);
        if (kv) {
            try { await kv.put(NAMES_KEY, JSON.stringify(namesMap)); } catch (e) { }
        }
    }
}
