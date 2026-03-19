import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchBulkStockQuotes } from '@/lib/api/client/quotesService';
import { fetchBulkNames } from '@/lib/api/client/namesService';
import { fetchBulkHistory } from '@/lib/api/client/historyService';

const ASSET_NAMES_CACHE_KEY = 'tracker_asset_names_v1';

export function useAssetSync({ userId, isLogged }) {
    const [assets, setAssets] = useState([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isSessionReady, setIsSessionReady] = useState(false);

    const refreshAssets = useCallback(async (list) => {
        if (!list || list.length === 0) return;
        setIsSyncing(true);

        // fixed comment
        // fixed comment
        let localNames = {};
        try {
            localNames = JSON.parse(localStorage.getItem(ASSET_NAMES_CACHE_KEY) || '{}');
        } catch (e) { /* ignore */ }

        const skeletonAssets = list.map(({ code, type }) => {
            const cacheKey = `${type}:${code}`;
            const cachedName = localNames[cacheKey];
            return {
                name: cachedName || `鍔犺浇涓?..`,
                price: 0,
                code,
                type,
                history: [],
                summary: null,
                changePercent: 0
            };
        });
        setAssets(skeletonAssets);

        // fixed comment
        try {
            const stockItems = list.filter(a => a.type === 'stock');
            const [stockQuoteMap, nameMap] = await Promise.all([
                fetchBulkStockQuotes(stockItems, true),
                fetchBulkNames(list.map(a => ({ code: a.code, type: a.type })), true),
            ]);

            const initialAssets = list.map(({ code, type }) => {
                const histKey = `${type}:${code}`;
                const name = nameMap[histKey];
                if (type === 'stock') {
                    const q = stockQuoteMap[code.toLowerCase()] || stockQuoteMap[code];
                    const resolvedName = q?.name || (name && name !== code ? name : `鑲＄エ ${code}`);
                    return { ...q, name: resolvedName, code, type };
                } else {
                    return { name: (name && name !== code ? name : `鍩洪噾 ${code}`), price: 0, code, type };
                }
            });

            setAssets(initialAssets);

            // fixed comment
            try {
                const newLocalNames = { ...localNames };
                Object.entries(nameMap).forEach(([key, val]) => {
                    if (val && val !== key.split(':')[1]) {
                        newLocalNames[key] = val;
                    }
                });
                localStorage.setItem(ASSET_NAMES_CACHE_KEY, JSON.stringify(newLocalNames));
            } catch (e) { /* ignore */ }

            // fixed comment
            // fixed comment
            fetchBulkHistory(list, false, 250).then(histMap => {
                setAssets(prev => prev.map(a => {
                    const key = `${a.type}:${a.code}`;
                    if (histMap[key]) {
                        return { ...a, ...histMap[key] };
                    }
                    return a;
                }));
            }).catch(e => console.warn('[Frontend:History] Background fetch failed:', e));

        } catch (e) {
            console.error('[Frontend] Refresh failed:', e);
        }

        setIsSyncing(false);
    }, []);

    // fixed comment
    useEffect(() => {
        if (!userId) return;

        // fixed comment
        // fixed comment
        const controller = new AbortController();

        const load = async () => {
            setIsSyncing(true);
            setIsSessionReady(false);
            // fixed comment
            setAssets([]);
            try {
                const res = await fetch('/api/user/assets', {
                    signal: controller.signal
                });
                const json = await res.json();
                // fixed comment
                const list = json?.data ?? json;
                if (Array.isArray(list) && list.length > 0) {
                    await refreshAssets(list);
                } else {
                    setAssets([]);
                }
            } catch (e) {
                // fixed comment
                if (e?.name !== 'AbortError') {
                    console.error('Failed to load user assets:', e);
                }
            }
            // fixed comment
            if (!controller.signal.aborted) {
                setIsSessionReady(true);
                setIsSyncing(false);
            }
        };

        load();

        // fixed comment
        return () => controller.abort();
    }, [userId, refreshAssets]);


    const assetsRef = useRef(assets);
    useEffect(() => {
        assetsRef.current = assets;
    }, [assets]);

    const syncingItemsRef = useRef(new Set());

    // [Feature: Client-side Offloading] 
    // fixed comment
    useEffect(() => {
        if (!isSessionReady || isSyncing) return;

        const pending = assets.filter(a =>
            (a.name === '鍔犺浇涓?..' || !a.history || a.history.length === 0) &&
            !syncingItemsRef.current.has(`${a.type}:${a.code}`)
        );

        if (pending.length === 0) return;

        // fixed comment
        const CONCURRENCY = 2;
        const toSync = pending.slice(0, CONCURRENCY);

        const runSync = async () => {
            // fixed comment
            toSync.forEach(item => syncingItemsRef.current.add(`${item.type}:${item.code}`));

            await Promise.all(toSync.map(async (item) => {
                const itemKey = `${item.type}:${item.code}`;
                try {
                    const res = await fetch('/api/user/sync-asset', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: item.code, type: item.type })
                    });
                    if (res.ok) {
                        const json = await res.json();
                        if (json.source !== 'queued') {
                            await refreshAssets(assetsRef.current);
                        }
                    }
                } catch (e) {
                    console.warn(`[ClientSync] Failed for ${item.code}:`, e.message);
                } finally {
                    // fixed comment
                    syncingItemsRef.current.delete(itemKey);
                }
            }));
        };

        const timer = setTimeout(runSync, 1000);
        return () => clearTimeout(timer);
    }, [assets, isSessionReady, isSyncing, refreshAssets]);




    // fixed comment
    const syncAssetsToServer = useCallback(async (currentAssets) => {
        if (!isLogged || !isSessionReady) return;
        // fixed comment
        const listToSync = Array.isArray(currentAssets) ? currentAssets : assetsRef.current;
        const skeleton = listToSync.map(a => ({ code: a.code, type: a.type }));
        try {
            await fetch('/api/user/assets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assets: skeleton }),
            });
        } catch (e) {
            console.error('Sync failed:', e);
        }
    }, [isLogged, userId, isSessionReady]);





    return { assets, setAssets, isSyncing, setIsSyncing, assetsRef, refreshAssets, syncAssetsToServer };
}
