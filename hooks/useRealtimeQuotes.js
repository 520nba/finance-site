import { useEffect } from 'react';
import { fetchBulkStockQuotes } from '@/services/api/quotesService';

export function useRealtimeQuotes({ activeTab, isLogged, assets, isSyncing, userId, setAssets, assetsRef, refreshAssets }) {
    // 实时数据自动轮询 (只轮询 Quotes 报价，历史/分时由组件内部按需分发)
    useEffect(() => {
        if (activeTab !== 'watchlist' || !isLogged || assets.length === 0) return;

        let tickCount = 0;
        const tick = async () => {
            if (isSyncing) return;
            tickCount++;

            // 1. 每 5 分钟才做一次跨设备检查（节省 4/5 的 KV 读取）
            if (tickCount % 5 === 0) {
                try {
                    const res = await fetch(`/api/user/assets?userId=${userId}`);
                    const remoteList = await res.json();
                    if (Array.isArray(remoteList)) {
                        const newCodes = remoteList.map(a => `${a.type}:${a.code}`).sort().join(',');
                        const oldCodes = assetsRef.current.map(a => `${a.type}:${a.code}`).sort().join(',');
                        if (newCodes !== oldCodes) {
                            refreshAssets(remoteList);
                            return; // 直接交给重加载进程接管
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // 2. 如果资产结构没变，继续原有的报价刷新流程
            // 从 ref 拿到最准的映射
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            // 只更新轻量级的 Quotes
            const quoteMap = await fetchBulkStockQuotes(stockItems);

            setAssets(prev => prev.map(a => {
                const q = quoteMap[a.code.toLowerCase()] || quoteMap[a.code];
                const newAsset = { ...a };
                if (q) {
                    newAsset.price = q.price;
                    newAsset.changePercent = q.changePercent;
                }
                return newAsset;
            }));
        };

        const timer = setInterval(tick, 60000);
        tick();
        return () => clearInterval(timer);
    }, [activeTab, isLogged, assets.length, isSyncing, userId, assetsRef, refreshAssets, setAssets]);
}
