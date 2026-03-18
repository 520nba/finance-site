import { useEffect, useRef } from 'react';
import { fetchBulkStockQuotes } from '@/lib/api/client/quotesService';
import { fetchBulkIntradayData } from '@/lib/api/client/intradayService';

export function useRealtimeQuotes({
    activeTab, isLogged, assetsRef,
    setQuotesMap,   // 鈫?鐜板湪鍐欏叆鐙珛鐨?quotesMap
    setIntradayMap  // 鈫?鍒嗘椂鏁版嵁鍚屾牱鐙珛
}) {
    // 1. 琛屾儏鎶ヤ环杞 (1min/5min 鍔ㄦ€?
    useEffect(() => {
        if (activeTab !== 'watchlist') return; // 鉁?浠呭湪瀹炴椂鐩戞帶妯″紡涓嬫縺娲婚珮棰戣疆璇?
        if (!isLogged) return;

        let timer;

        const tick = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                // 鉁?鍐欏叆鐙珛鐨?quotesMap锛屼笉瑙︾琚?AssetsStructureContext 绠＄悊s assets 鏁扮粍
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
            // 浜ゆ槗鏃舵姣忓垎閽熸洿鏂帮紝闈炰氦鏄撴椂娈垫瘡 5 鍒嗛挓鏇存柊
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

    // 2. 鍒嗘椂鏁版嵁鎵归噺杞 (鍥哄畾 2 鍒嗛挓)
    const intradayMapRef = useRef({}); // 寮曞叆杈呭姪 Ref 鐢ㄤ簬闂寘鍐呯殑鏈€鏂扮姸鎬佸姣?

    useEffect(() => {
        if (activeTab !== 'watchlist') return;
        if (!isLogged) return;

        const tickIntraday = async () => {
            const stockItems = assetsRef.current.filter(a => a.type === 'stock');
            if (stockItems.length === 0) return;

            try {
                const result = await fetchBulkIntradayData(stockItems, true);
                if (Object.keys(result).length > 0) {
                    // 鉁?鏍稿績淇锛氬悎骞惰€岄潪瑕嗙洊锛岄槻姝㈢敱浜庨儴鍒嗚姹傝秴鏃跺鑷村凡鏈夋暟鎹鎶归櫎
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

        // 棣栨鍔犺浇琛ュ叏绛栫暐锛氱敱浜?sync-asset 鍙兘杩樺湪鍚庡彴锛宼ickIntraday 鍙兘鍥犱负鍚庣 D1 娌″噯澶囧ソ鑰岃烦杩囥€?
        // 涓烘澧炲姞涓€涓?30s 鍚庣殑鈥滄壂灏锯€濆紓姝ヤ换鍔°€?
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
