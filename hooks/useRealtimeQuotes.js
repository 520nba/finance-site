import { useEffect, useRef } from 'react';
import { fetchBulkStockQuotes } from '@/lib/api/client/quotesService';
import { fetchBulkIntradayData } from '@/lib/api/client/intradayService';

export function useRealtimeQuotes({
    activeTab, isLogged, assetsRef,
    setQuotesMap,   // → 现在写入独立的 quotesMap
    setIntradayMap  // → 分时数据同样独立
}) {
    // 1. 行情报价轮询 (1min/5min 动态)
    useEffect(() => {
        if (activeTab !== 'watchlist') return; // 仅在实时监控模式下激活高频轮询
        if (!isLogged) return;

        let timer;

        const tick = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                // 写入独立的 quotesMap，不触碰被 AssetProvider 管理的 assets 数组
                const quoteMap = await fetchBulkStockQuotes(stockItems, true);
                if (Object.keys(quoteMap).length > 0) {
                    setQuotesMap(prev => ({ ...prev, ...quoteMap }));
                }
            } catch (e) {
                console.warn('[RealtimeQuotes] Tick failed:', e.message);
            }
        };

        const getInterval = () => {
            const hourStr = new Date().toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false
            });
            const hour = parseInt(hourStr);
            // 交易时段每分钟更新，非交易时段每 5 分钟更新
            const isInSession = (hour >= 9 && hour < 12) || (hour >= 13 && hour < 15);
            return isInSession ? 60000 : 300000;
        };

        const scheduleNext = () => {
            timer = setTimeout(async () => {
                await tick();
                scheduleNext();
            }, getInterval());
        };

        tick();
        scheduleNext();

        return () => clearTimeout(timer);
    }, [activeTab, isLogged, assetsRef, setQuotesMap]);

    // 2. 分时数据批量轮询 (固定 2 分钟)
    const intradayMapRef = useRef({}); // 用于在异步回调中读取最新状态

    useEffect(() => {
        if (activeTab !== 'watchlist') return;
        if (!isLogged) return;

        const tickIntraday = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                const result = await fetchBulkIntradayData(stockItems, true);
                if (Object.keys(result).length > 0) {
                    // 统一分时数据批量轮询（替代此前各卡片独立 SWR，大幅节省 Fetch 配额）
                    setIntradayMap(prev => {
                        const next = { ...prev, ...result };
                        intradayMapRef.current = next;
                        return next;
                    });
                }
            } catch (e) {
                console.warn('[IntradayQuotes] Tick failed:', e.message);
            }
        };

        // 首次加载后检查缺失的资产，30秒后重试一次
        // 解决网络缓慢时首批请求未取到的问题
        tickIntraday().then(() => {
            const missing = assetsRef.current.filter(a => a.type === 'stock' && !intradayMapRef.current[a.code]);
            if (missing.length > 0) {
                setTimeout(tickIntraday, 30000);
            }
        });

        const intradayTimer = setInterval(tickIntraday, 120000);

        return () => clearInterval(intradayTimer);
    }, [activeTab, isLogged, assetsRef, setIntradayMap]);
}
