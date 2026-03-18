'use client';

import { useState, useEffect, useRef, memo, useMemo } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import VolatilityChart from './VolatilityChart';
import IntradayChart from './IntradayChart';
import { calculatePerformance } from '@/lib/utils';
import { fetchBulkHistory } from '@/lib/api/client/historyService';
import { useQuotes } from '@/providers/AssetProvider';

// 鐙珛瀛愮粍浠讹紝灞曠ず鍏蜂綋鏃舵鐨勮〃鐜?
function MetricPanel({ label, value, history = [], days }) {
    if (value === null || value === undefined) {
        return (
            <div className="flex flex-col gap-2 opacity-50">
                <div className="flex justify-between items-end">
                    <span className="text-sm font-bold opacity-40 uppercase tracking-tighter">{label}琛ㄧ幇</span>
                    <span className="text-base font-mono font-bold text-white/20">--</span>
                </div>
                <div className="h-[80px] bg-white/5 rounded-lg border border-white/5 flex items-center justify-center text-[10px] italic">
                    鏃犳暟鎹?
                </div>
            </div>
        );
    }

    const isPositive = value >= 0;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
                <span className="text-sm font-bold opacity-40 uppercase tracking-tighter">{label}琛ㄧ幇</span>
                <span className={`text-base font-mono font-bold ${isPositive ? 'text-red-400' : 'text-green-400'}`}>
                    {isPositive ? '+' : ''}{value.toFixed(2)}%
                </span>
            </div>
            {history.length > 0 ? (
                <VolatilityChart
                    data={calculatePerformance(history, days)}
                    title={label}
                    color={isPositive ? '#ef4444' : '#10b981'}
                    height={80}
                    compact={true}
                />
            ) : (
                <div className="h-[80px] flex items-center justify-center text-white/20 text-[10px] italic bg-white/5 rounded-lg">
                    鍥捐〃鍔犺浇涓?..
                </div>
            )}
        </div>
    );
}

// 鈹€鈹€ 1. 瀹炴椂妯″紡鍐呮牳锛氬敮涓€璁㈤槄 QuotesContext 鐨勫湴鏂?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function RealtimeLayer({ asset }) {
    const { quotesMap, intradayMap } = useQuotes();
    const quote = quotesMap[asset.code.toLowerCase()];
    const intradayData = intradayMap[asset.code];

    const displayChange = quote?.changePercent ?? asset.changePercent;
    const isPositiveChange = (displayChange ?? 0) >= 0;
    const intraPoints = intradayData?.points ?? [];

    // 鍏抽敭淇锛氱Щ闄ゆ棤鏁堢殑 .price 瀛楁锛堟暟鎹偣鍙湁 value锛夛紱涓斾紭鍏堜娇鐢ㄦ湇鍔＄鐨?prevClose 纭繚瓒嬪娍鍧愭爣绯绘纭?
    const finalPrevClose = intradayData?.prevClose || asset.prevClose || intraPoints[0]?.value;
    const hasData = intraPoints.length > 0;

    return (
        <div className="mt-2 text-right">
            <div className="flex flex-col items-end mb-4 absolute top-4 right-4 group-hover:top-3 transition-all">
                <div className={`text-2xl font-black italic shadow-text leading-none font-mono ${isPositiveChange ? 'text-red-400' : 'text-green-400'}`}>
                    {isPositiveChange ? '+' : ''}{displayChange?.toFixed(1)}%
                </div>
            </div>

            <div className="mt-2">
                {asset.type === 'fund' ? (
                    <div className="h-[120px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                        <span className="italic">鍦哄鍩洪噾涓嶆敮鎸佸垎鏃舵暟鎹?/span>
                    </div>
                ) : hasData ? (
                    <IntradayChart
                        data={intraPoints}
                        prevClose={finalPrevClose}
                        height={120}
                    />
                ) : (
                    <div className="h-[120px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                        <span className="italic">浠婃棩鏆傛棤鍒嗘椂浜ゆ槗鏁版嵁</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// 鈹€鈹€ 2. 娉㈠姩鐜囧唴鏍革細瀹屽叏涓嶅缓绔?QuotesContext 璁㈤槄 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function VolatilityLayer({ asset, isVisible }) {
    // 1. 浼樺厛妫€鏌?Context 閲屾槸鍚﹀凡缁忔湁鎵归噺鍙栧洖鐨勫巻鍙叉暟鎹?
    const hasContextHistory = asset.history?.length > 0;

    // 2. 鍔犱竴涓欢杩熸爣蹇楋紝绛?refreshAssets 鐨勫紓姝?history 鍔犺浇瀹屾垚
    const [isReady, setIsReady] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setIsReady(true), 800);
        return () => clearTimeout(timer);
    }, [asset.code]); // asset.code 鍙樺寲鏃堕噸缃紝闃叉鍒囨崲璧勪骇娈嬬暀鏃х姸鎬?

    // 3. 鍙栧緱 localStorage 涓殑缂撳瓨 (鍚屾鏂规锛岀‘淇?fallbackData 姝ｇ‘鍒濆鍖?
    const storageKey = `tracker_cache_hist:${asset.type}:${asset.code}`;
    const [initialCachedData] = useState(() => {
        if (typeof window === 'undefined') return undefined;
        try {
            const val = localStorage.getItem(storageKey);
            return val ? JSON.parse(val) : undefined;
        } catch (e) { return undefined; }
    });

    // 4. 鍘嗗彶鏁版嵁鑾峰彇
    const { data: historyData } = useSWR(
        // isReady 纭繚绛夊緟 Context 鏁版嵁鏈夋満浼氬～鍏咃紝鍐嶅喅瀹氭槸鍚﹀彂璇锋眰
        isVisible && isReady && !hasContextHistory
            ? `hist:${asset.type}:${asset.code}`
            : null,
        () => fetchBulkHistory([{ code: asset.code, type: asset.type }], false)
            .then(res => res[`${asset.type}:${asset.code}`]),
        {
            fallbackData: initialCachedData,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,  // 鏂綉閲嶈繛涓嶈Е鍙戣姹?
            dedupingInterval: 300000,       // 5 鍒嗛挓鍐呬笉閲嶅璇锋眰鐩稿悓 key
            onSuccess: (data) => {
                if (data) localStorage.setItem(storageKey, JSON.stringify(data));
            }
        }
    );

    // 5. 鏁版嵁鍚堝苟浼樺厛绾э細Context > SWR > 榛樿绌烘灦瀛?
    const history = hasContextHistory
        ? asset.history
        : (historyData?.history ?? []);

    const summary = hasContextHistory
        ? asset.summary
        : (historyData?.summary ?? { perf5d: null, perf22d: null, perf250d: null });

    const isHistorySyncing = (!hasContextHistory && historyData?.status === 'syncing');

    if (isHistorySyncing) {
        return (
            <div className="h-[100px] flex flex-col items-center justify-center gap-3 bg-white/5 rounded-xl border border-dashed border-white/10 mt-2">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-5 h-5 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full"
                />
                <span className="text-xs font-bold text-cyan-500/60 uppercase tracking-widest italic animate-pulse">
                    鍘嗗彶琛屾儏鍚屾涓?(鍚庡彴浠诲姟)...
                </span>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-white/5 mt-2">
            <MetricPanel label="5鏃? value={summary.perf5d} history={history} days={5} />
            <MetricPanel label="22鏃? value={summary.perf22d} history={history} days={22} />
            <MetricPanel label="250鏃? value={summary.perf250d} history={history} days={250} />
        </div>
    );
}

function AssetCardComponent({ asset, onRemove, mode = 'volatility' }) {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef(null);

    // 鐩戝惉杩涘叆瑙嗗彛锛屽疄鐜板欢杩熷疄渚嬪寲
    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                obs.disconnect();
            }
        }, { rootMargin: '200px' });

        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    return (
        <motion.div
            ref={containerRef}
            layout
            id={`asset-${asset.code}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass-effect p-4 lg:p-5 group relative"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex-1 min-w-0 mr-4">
                    <h3 className="text-xl font-black italic truncate whitespace-nowrap leading-tight text-white/90">
                        {asset.name}
                    </h3>
                    <p className="text-[10px] font-bold opacity-20 uppercase tracking-[0.2em] mt-1 font-mono">{asset.code}</p>
                </div>
                <div className="flex flex-col items-end gap-1 z-10">
                    <button
                        onClick={() => onRemove(asset.code)}
                        aria-label="鍒犻櫎璧勪骇"
                        className="p-1.5 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* 鏍稿績鍐呭锛氭寜妯″紡鍒嗗彂瀛愮粍浠讹紝瀹炵幇 Context 璁㈤槄鐗╃悊闅旂 */}
            {mode === 'realtime' ? (
                <RealtimeLayer asset={asset} />
            ) : (
                <VolatilityLayer asset={asset} isVisible={isVisible} />
            )}
        </motion.div>
    );
}

export default memo(AssetCardComponent, (prev, next) => {
    // 鍩虹鍙樻洿鍒ゅ畾
    if (prev.mode !== next.mode) return false;
    if (prev.asset.code !== next.asset.code) return false;
    if (prev.asset.name !== next.asset.name) return false;
    if (prev.onRemove !== next.onRemove) return false;

    // 娉㈠姩鐜囨ā寮忥細浠呮瘮瀵瑰巻鍙叉暟鎹殑鏈€鍚庝竴鏉℃棩鏈燂紙閫氬父涓€澶╁彉涓€娆★級
    if (prev.mode === 'volatility') {
        const prevDate = prev.asset.history?.at(-1)?.date;
        const nextDate = next.asset.history?.at(-1)?.date;
        return prevDate === nextDate;
    }

    return true;
});
