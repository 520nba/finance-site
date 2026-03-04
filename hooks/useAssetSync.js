import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchBulkStockQuotes } from '@/services/api/quotesService';
import { fetchBulkNames } from '@/services/api/namesService';
import { fetchBulkHistory } from '@/services/api/historyService';

export function useAssetSync({ userId, isLogged }) {
    const [assets, setAssets] = useState([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isSessionReady, setIsSessionReady] = useState(false);
    const [loadedUserId, setLoadedUserId] = useState('');

    const refreshAssets = useCallback(async (list) => {
        if (!list || list.length === 0) return;
        setIsSyncing(true);

        // 1. 立刻渲染骨架，消除阻塞感。
        const skeletonAssets = list.map(({ code, type }) => ({
            name: `加载中...`, price: 0, code, type, history: [], summary: null, changePercent: 0
        }));
        setAssets(skeletonAssets);

        // 2. 仅获取基础名称与股票实时报价
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

            // 3. 异步补充历史数据 (Orchestrator Layer 1.5 - Background Hydration)
            // 这一步不需要阻塞，完成后会自动触发 UI 图表渲染
            fetchBulkHistory(list, true, 250).then(histMap => {
                setAssets(prev => prev.map(a => {
                    const key = `${a.type}:${a.code}`;
                    if (histMap[key]) {
                        return { ...a, ...histMap[key] };
                    }
                    return a;
                }));
            }).catch(() => { });

        } catch (e) {
            console.error('[Frontend] Refresh failed:', e);
        }

        setIsSyncing(false);
    }, []);

    // 登录后加载服务端数据
    useEffect(() => {
        if (!userId) return;
        const load = async () => {
            setIsSyncing(true);
            setIsSessionReady(false);
            try {
                const res = await fetch(`/api/user/assets?userId=${userId}`);
                const json = await res.json();
                // 后端统一返回 { success, data: [] } envelope 格式
                const list = json?.data ?? json;
                if (Array.isArray(list) && list.length > 0) {
                    await refreshAssets(list);
                } else {
                    setAssets([]);
                }
            } catch (e) {
                console.error('Failed to load user assets:', e);
            }
            setIsSessionReady(true);
            setLoadedUserId(userId);
            setIsSyncing(false);
        };
        load();
        localStorage.setItem('tracker_user_id', userId);
    }, [userId, refreshAssets]);

    // 使用 code 拼接的字符串作为依赖，避免轮询引发价格变动导致持续的高频 KV 覆写
    const assetCodesStr = assets.map(a => `${a.type}:${a.code}`).sort().join(',');

    // 数据变化后同步到服务端（禁止初始化阶段覆盖）
    useEffect(() => {
        if (!isLogged || !userId || !isSessionReady || userId !== loadedUserId) return;
        const sync = async () => {
            const skeleton = assets.map(a => ({ code: a.code, type: a.type }));
            try {
                await fetch('/api/user/assets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, assets: skeleton }),
                });
                // 广播事件通知同浏览器的其他 Tab 页面
                localStorage.setItem('tracker_assets_updated', Date.now().toString());
            } catch (e) {
                console.error('Sync failed:', e);
            }
        };
        sync();
        // assets 对象数组有意省略：assetCodesStr 已精确代表列表的增删变化，
        // 避免在价格轮询更新时（价格变化 → assets 引用变化）触发不必要的 KV 写回。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assetCodesStr, userId, isLogged, isSessionReady, loadedUserId]);

    const assetsRef = useRef(assets);
    useEffect(() => {
        assetsRef.current = assets;
    }, [assets]);

    // 监听多标签页同步防冲突 (跨 Tab 数据漂移保护)
    useEffect(() => {
        const handleStorage = (e) => {
            if (e.key === 'tracker_assets_updated' && isLogged && userId) {
                fetch(`/api/user/assets?userId=${userId}`).then(r => r.json()).then(json => {
                    const list = json?.data ?? json;
                    if (Array.isArray(list)) {
                        const newStr = list.map(a => `${a.type}:${a.code}`).sort().join(',');
                        const oldStr = assetsRef.current.map(a => `${a.type}:${a.code}`).sort().join(',');
                        if (newStr !== oldStr) refreshAssets(list);
                    }
                }).catch(() => { });
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [isLogged, userId, refreshAssets]);

    return { assets, setAssets, isSyncing, setIsSyncing, assetsRef, refreshAssets };
}
