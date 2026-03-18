import { useEffect } from 'react';
import { fetchBulkStockQuotes } from '@/services/api/quotesService';
import { fetchBulkIntradayData } from '@/services/api/intradayService';

export function useRealtimeQuotes({
    activeTab, isLogged, assetsRef,
    setQuotesMap,   // ← 现在写入独立的 quotesMap
    setIntradayMap  // ← 分时数据同样独立
}) {
    // 1. 行情报价轮询 (1min/5min 动态)
    useEffect(() => {
        if (activeTab !== 'watchlist') return; // ✅ 仅在实时监控模式下激活高频轮询
        if (!isLogged) return;

        let timer;

        const tick = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                // ✅ 写入独立的 quotesMap，不触碰被 AssetsStructureContext 管理s assets 数组
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
    useEffect(() => {
        if (activeTab !== 'watchlist') return; // ✅ 同上，节约非实时监控下的网络开销
        if (!isLogged) return;

        const tickIntraday = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                // 统一分时数据批量轮询（替代此前各卡片独立 SWR，大幅节省 Fetch 配额）
                const result = await fetchBulkIntradayData(stockItems, true);
                if (Object.keys(result).length > 0) {
                    setIntradayMap(result);
                }
            } catch (e) {
                console.warn('[IntradayQuotes] Tick failed:', e.message);
            }
        };

        tickIntraday();
        const intradayTimer = setInterval(tickIntraday, 120000);

        return () => clearInterval(intradayTimer);
    }, [activeTab, isLogged, assetsRef, setIntradayMap]);
}
