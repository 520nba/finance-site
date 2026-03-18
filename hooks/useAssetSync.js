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

        // 1. 立刻渲染骨架，消除阻塞感�?
        // [Optimized] 优先�?localStorage 读取缓存名称，实现秒开显示
        let localNames = {};
        try {
            localNames = JSON.parse(localStorage.getItem(ASSET_NAMES_CACHE_KEY) || '{}');
        } catch (e) { /* ignore */ }

        const skeletonAssets = list.map(({ code, type }) => {
            const cacheKey = `${type}:${code}`;
            const cachedName = localNames[cacheKey];
            return {
                name: cachedName || `加载�?..`,
                price: 0,
                code,
                type,
                history: [],
                summary: null,
                changePercent: 0
            };
        });
        setAssets(skeletonAssets);

        // 2. 仅获取基础名称与股票实时报�?
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
                    const resolvedName = q?.name || (name && name !== code ? name : `股票 ${code}`);
                    return { ...q, name: resolvedName, code, type };
                } else {
                    return { name: (name && name !== code ? name : `基金 ${code}`), price: 0, code, type };
                }
            });

            setAssets(initialAssets);

            // [Optimized] 持久化名称到本地，供下次刷新秒显
            try {
                const newLocalNames = { ...localNames };
                Object.entries(nameMap).forEach(([key, val]) => {
                    if (val && val !== key.split(':')[1]) {
                        newLocalNames[key] = val;
                    }
                });
                localStorage.setItem(ASSET_NAMES_CACHE_KEY, JSON.stringify(newLocalNames));
            } catch (e) { /* ignore */ }

            // 3. 异步补充历史数据 (Orchestrator Layer 1.5 - Background Hydration)
            // 这一步不需要阻塞，完成后会自动触发 UI 图表渲染
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

    // 登录后加载服务端数据
    useEffect(() => {
        if (!userId) return;

        // 防竞态：每次 userId 变化创建新的 AbortController
        // �?userId 再次变化（快速切换账号），旧的请求会�?abort，防止串�?
        const controller = new AbortController();

        const load = async () => {
            setIsSyncing(true);
            setIsSessionReady(false);
            // 切换账号时立即清空资产，避免短暂显示旧账号数�?
            setAssets([]);
            try {
                const res = await fetch('/api/user/assets', {
                    signal: controller.signal
                });
                const json = await res.json();
                // 后端统一返回 { success, data: [] } envelope 格式
                const list = json?.data ?? json;
                if (Array.isArray(list) && list.length > 0) {
                    await refreshAssets(list);
                } else {
                    setAssets([]);
                }
            } catch (e) {
                // AbortError 是主动取消，不是真正的错误，静默处理
                if (e?.name !== 'AbortError') {
                    console.error('Failed to load user assets:', e);
                }
            }
            // 只在请求未被取消时更�?Session 状�?
            if (!controller.signal.aborted) {
                setIsSessionReady(true);
                setIsSyncing(false);
            }
        };

        load();

        // Cleanup：当 userId 变化或组件卸载时，取消正在进行的请求
        return () => controller.abort();
    }, [userId, refreshAssets]);


    const assetsRef = useRef(assets);
    useEffect(() => {
        assetsRef.current = assets;
    }, [assets]);

    const syncingItemsRef = useRef(new Set());

    // [Feature: Client-side Offloading] 
    // 前端主动拨调：发现数据空洞（缺失名称或历史）时，分片同步�?D1
    useEffect(() => {
        if (!isSessionReady || isSyncing) return;

        const pending = assets.filter(a =>
            (a.name === '加载�?..' || !a.history || a.history.length === 0) &&
            !syncingItemsRef.current.has(`${a.type}:${a.code}`)
        );

        if (pending.length === 0) return;

        // 设置并发限制，避免瞬间冲�?Worker 或触发频率限�?
        const CONCURRENCY = 2;
        const toSync = pending.slice(0, CONCURRENCY);

        const runSync = async () => {
            // 锁定正在处理的项目，防止重入导致的无限循�?
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
                        // 同步成功后，重新局部刷新该资产的数�?
                        await refreshAssets(assetsRef.current);
                    }
                } catch (e) {
                    console.warn(`[ClientSync] Failed for ${item.code}:`, e.message);
                } finally {
                    // 解锁
                    syncingItemsRef.current.delete(itemKey);
                }
            }));
        };

        const timer = setTimeout(runSync, 1000);
        return () => clearTimeout(timer);
    }, [assets, isSessionReady, isSyncing, refreshAssets]);




    // 数据变化后同步到服务端（暴露给外部主动调用）
    const syncAssetsToServer = useCallback(async (currentAssets) => {
        if (!isLogged || !isSessionReady) return;
        // 优先使用传入的列表，否则读取 Ref（避免把 assets 列入 useCallback 依赖，防止实时报价更新时重建函数引用�?
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
