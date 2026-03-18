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

        // 1. 绔嬪埢娓叉煋楠ㄦ灦锛屾秷闄ら樆濉炴劅銆?
        // [Optimized] 浼樺厛浠?localStorage 璇诲彇缂撳瓨鍚嶇О锛屽疄鐜扮寮€鏄剧ず
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

        // 2. 浠呰幏鍙栧熀纭€鍚嶇О涓庤偂绁ㄥ疄鏃舵姤浠?
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

            // [Optimized] 鎸佷箙鍖栧悕绉板埌鏈湴锛屼緵涓嬫鍒锋柊绉掓樉
            try {
                const newLocalNames = { ...localNames };
                Object.entries(nameMap).forEach(([key, val]) => {
                    if (val && val !== key.split(':')[1]) {
                        newLocalNames[key] = val;
                    }
                });
                localStorage.setItem(ASSET_NAMES_CACHE_KEY, JSON.stringify(newLocalNames));
            } catch (e) { /* ignore */ }

            // 3. 寮傛琛ュ厖鍘嗗彶鏁版嵁 (Orchestrator Layer 1.5 - Background Hydration)
            // 杩欎竴姝ヤ笉闇€瑕侀樆濉烇紝瀹屾垚鍚庝細鑷姩瑙﹀彂 UI 鍥捐〃娓叉煋
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

    // 鐧诲綍鍚庡姞杞芥湇鍔＄鏁版嵁
    useEffect(() => {
        if (!userId) return;

        // 闃茬珵鎬侊細姣忔 userId 鍙樺寲鍒涘缓鏂扮殑 AbortController
        // 褰?userId 鍐嶆鍙樺寲锛堝揩閫熷垏鎹㈣处鍙凤級锛屾棫鐨勮姹備細琚?abort锛岄槻姝覆鎴?
        const controller = new AbortController();

        const load = async () => {
            setIsSyncing(true);
            setIsSessionReady(false);
            // 鍒囨崲璐﹀彿鏃剁珛鍗虫竻绌鸿祫浜э紝閬垮厤鐭殏鏄剧ず鏃ц处鍙锋暟鎹?
            setAssets([]);
            try {
                const res = await fetch('/api/user/assets', {
                    signal: controller.signal
                });
                const json = await res.json();
                // 鍚庣缁熶竴杩斿洖 { success, data: [] } envelope 鏍煎紡
                const list = json?.data ?? json;
                if (Array.isArray(list) && list.length > 0) {
                    await refreshAssets(list);
                } else {
                    setAssets([]);
                }
            } catch (e) {
                // AbortError 鏄富鍔ㄥ彇娑堬紝涓嶆槸鐪熸鐨勯敊璇紝闈欓粯澶勭悊
                if (e?.name !== 'AbortError') {
                    console.error('Failed to load user assets:', e);
                }
            }
            // 鍙湪璇锋眰鏈鍙栨秷鏃舵洿鏂?Session 鐘舵€?
            if (!controller.signal.aborted) {
                setIsSessionReady(true);
                setIsSyncing(false);
            }
        };

        load();

        // Cleanup锛氬綋 userId 鍙樺寲鎴栫粍浠跺嵏杞芥椂锛屽彇娑堟鍦ㄨ繘琛岀殑璇锋眰
        return () => controller.abort();
    }, [userId, refreshAssets]);


    const assetsRef = useRef(assets);
    useEffect(() => {
        assetsRef.current = assets;
    }, [assets]);

    const syncingItemsRef = useRef(new Set());

    // [Feature: Client-side Offloading] 
    // 鍓嶇涓诲姩鎷ㄨ皟锛氬彂鐜版暟鎹┖娲烇紙缂哄け鍚嶇О鎴栧巻鍙诧級鏃讹紝鍒嗙墖鍚屾鑷?D1
    useEffect(() => {
        if (!isSessionReady || isSyncing) return;

        const pending = assets.filter(a =>
            (a.name === '鍔犺浇涓?..' || !a.history || a.history.length === 0) &&
            !syncingItemsRef.current.has(`${a.type}:${a.code}`)
        );

        if (pending.length === 0) return;

        // 璁剧疆骞跺彂闄愬埗锛岄伩鍏嶇灛闂村啿鍨?Worker 鎴栬Е鍙戦鐜囬檺鍒?
        const CONCURRENCY = 2;
        const toSync = pending.slice(0, CONCURRENCY);

        const runSync = async () => {
            // 閿佸畾姝ｅ湪澶勭悊鐨勯」鐩紝闃叉閲嶅叆瀵艰嚧鐨勬棤闄愬惊鐜?
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
                        // 鍚屾鎴愬姛鍚庯紝閲嶆柊灞€閮ㄥ埛鏂拌璧勪骇鐨勬暟鎹?
                        await refreshAssets(assetsRef.current);
                    }
                } catch (e) {
                    console.warn(`[ClientSync] Failed for ${item.code}:`, e.message);
                } finally {
                    // 瑙ｉ攣
                    syncingItemsRef.current.delete(itemKey);
                }
            }));
        };

        const timer = setTimeout(runSync, 1000);
        return () => clearTimeout(timer);
    }, [assets, isSessionReady, isSyncing, refreshAssets]);




    // 鏁版嵁鍙樺寲鍚庡悓姝ュ埌鏈嶅姟绔紙鏆撮湶缁欏閮ㄤ富鍔ㄨ皟鐢級
    const syncAssetsToServer = useCallback(async (currentAssets) => {
        if (!isLogged || !isSessionReady) return;
        // 浼樺厛浣跨敤浼犲叆鐨勫垪琛紝鍚﹀垯璇诲彇 Ref锛堥伩鍏嶆妸 assets 鍒楀叆 useCallback 渚濊禆锛岄槻姝㈠疄鏃舵姤浠锋洿鏂版椂閲嶅缓鍑芥暟寮曠敤锛?
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
