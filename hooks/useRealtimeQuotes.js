import { useEffect, useRef } from 'react';
import { fetchBulkStockQuotes } from '@/lib/api/client/quotesService';
import { fetchBulkIntradayData } from '@/lib/api/client/intradayService';

export function useRealtimeQuotes({
    activeTab, isLogged, assetsRef,
    setQuotesMap,   // fixed comment
    setIntradayMap  // fixed comment
}) {
    // fixed comment
    useEffect(() => {
        if (activeTab !== 'watchlist') return; // fixed comment
        if (!isLogged) return;

        let timer;

        const tick = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                // fixed comment
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
            // fixed comment
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

    // fixed comment
    const intradayMapRef = useRef({}); // fixed comment

    useEffect(() => {
        if (activeTab !== 'watchlist') return;
        if (!isLogged) return;

        const tickIntraday = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                const result = await fetchBulkIntradayData(stockItems, true);
                if (Object.keys(result).length > 0) {
                    // fixed comment
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

        // fixed comment
        // fixed comment
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
