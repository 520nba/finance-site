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

            // 1. 每 5 次 tick（根据动态间隔，约 5-25 分钟）做一次跨设备同步检查
            if (tickCount % 5 === 0) {
                try {
                    const res = await fetch('/api/user/assets');
                    const remoteList = (await res.json())?.data || [];
                    if (Array.isArray(remoteList)) {
                        const newCodes = remoteList.map(a => `${a.type}:${a.code}`).sort().join(',');
                        const oldCodes = assetsRef.current.map(a => `${a.type}:${a.code}`).sort().join(',');
                        if (newCodes !== oldCodes) {
                            refreshAssets(remoteList);
                            return true; // 返回 true 表示由于结构变更需要中断本次 tick
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // 2. 正常行情刷新流程
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            const quoteMap = await fetchBulkStockQuotes(stockItems);

            setAssets(prev => prev.map(a => {
                const q = quoteMap[a.code.toLowerCase()] || quoteMap[a.code];
                if (q) return { ...a, price: q.price, changePercent: q.changePercent };
                return a;
            }));
            return false;
        };

        // 动态计算轮询间隔：盘中 1 分钟，盘外 5 分钟
        const getInterval = () => {
            const hourStr = new Date().toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false
            });
            const hour = parseInt(hourStr);
            const isInSession = (hour >= 9 && hour < 12) || (hour >= 13 && hour < 15);
            return isInSession ? 60000 : 300000;
        };

        let timer;
        const scheduleNext = () => {
            timer = setTimeout(async () => {
                const interrupted = await tick();
                if (!interrupted) scheduleNext();
            }, getInterval());
        };

        tick();
        scheduleNext();
        return () => clearTimeout(timer);
    }, [activeTab, isLogged, assets.length, isSyncing, userId, assetsRef, refreshAssets, setAssets]);
}
