'use client';

import { useState, useEffect, useRef, memo, useMemo } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import VolatilityChart from './VolatilityChart';
import IntradayChart from './IntradayChart';
import { calculatePerformance } from '@/lib/utils';
import { fetchBulkHistory } from '@/services/api/historyService';
import { useQuotes } from '@/providers/AssetProvider';

// 独立子组件，展示具体时段的表现
function MetricPanel({ label, value, history = [], days }) {
    if (value === null || value === undefined) {
        return (
            <div className="flex flex-col gap-2 opacity-50">
                <div className="flex justify-between items-end">
                    <span className="text-sm font-bold opacity-40 uppercase tracking-tighter">{label}表现</span>
                    <span className="text-base font-mono font-bold text-white/20">--</span>
                </div>
                <div className="h-[80px] bg-white/5 rounded-lg border border-white/5 flex items-center justify-center text-[10px] italic">
                    无数据
                </div>
            </div>
        );
    }

    const isPositive = value >= 0;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
                <span className="text-sm font-bold opacity-40 uppercase tracking-tighter">{label}表现</span>
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
                    图表加载中...
                </div>
            )}
        </div>
    );
}

// ── 1. 实时模式内核：唯一订阅 QuotesContext 的地方 ─────────────────────
function RealtimeLayer({ asset }) {
    const { quotesMap, intradayMap } = useQuotes();
    const quote = quotesMap[asset.code.toLowerCase()];
    const intradayData = intradayMap[asset.code];

    const displayChange = quote?.changePercent ?? asset.changePercent;
    const isPositiveChange = (displayChange ?? 0) >= 0;
    const intraPoints = intradayData?.points ?? [];

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
                        <span className="italic">场外基金不支持分时数据</span>
                    </div>
                ) : (intraPoints.length > 0 && (asset.prevClose || intradayData?.prevClose)) ? (
                    <IntradayChart
                        data={intraPoints}
                        prevClose={asset.prevClose || intradayData?.prevClose}
                        height={120}
                    />
                ) : (
                    <div className="h-[120px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                        <span className="italic">今日暂无分时交易数据</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── 2. 波动率内核：完全不建立 QuotesContext 订阅 ──────────────────────────
function VolatilityLayer({ asset, isVisible }) {
    // 取得 localStorage 中的缓存作为首屏 fallback
    const cachedHistory = useMemo(() => {
        try { return JSON.parse(localStorage.getItem(`tracker_cache_hist:${asset.type}:${asset.code}`)) }
        catch { return undefined }
    }, [asset.type, asset.code]);

    // 历史数据获取 (仅在可见时启用)
    const { data: historyData } = useSWR(
        isVisible ? `hist:${asset.type}:${asset.code}` : null,
        () => fetchBulkHistory([{ code: asset.code, type: asset.type }], false).then(res => res[`${asset.type}:${asset.code}`]),
        {
            fallbackData: cachedHistory,
            revalidateOnFocus: false,
            onSuccess: (data) => {
                if (data) localStorage.setItem(`tracker_cache_hist:${asset.type}:${asset.code}`, JSON.stringify(data));
            }
        }
    );

    const history = (historyData?.history?.length > 0) ? historyData.history : (asset.history ?? []);
    const summary = (historyData?.summary) ?? (asset.summary ?? { perf5d: null, perf22d: null, perf250d: null });
    const isHistorySyncing = historyData?.status === 'syncing';

    if (isHistorySyncing) {
        return (
            <div className="h-[100px] flex flex-col items-center justify-center gap-3 bg-white/5 rounded-xl border border-dashed border-white/10 mt-2">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-5 h-5 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full"
                />
                <span className="text-xs font-bold text-cyan-500/60 uppercase tracking-widest italic animate-pulse">
                    历史行情同步中 (后台任务)...
                </span>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-white/5 mt-2">
            <MetricPanel label="5日" value={summary.perf5d} history={history} days={5} />
            <MetricPanel label="22日" value={summary.perf22d} history={history} days={22} />
            <MetricPanel label="250日" value={summary.perf250d} history={history} days={250} />
        </div>
    );
}

function AssetCardComponent({ asset, onRemove, mode = 'volatility' }) {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef(null);

    // 监听进入视口，实现延迟实例化
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
                        aria-label="删除资产"
                        className="p-1.5 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* 核心内容：按模式分发子组件，实现 Context 订阅物理隔离 */}
            {mode === 'realtime' ? (
                <RealtimeLayer asset={asset} />
            ) : (
                <VolatilityLayer asset={asset} isVisible={isVisible} />
            )}
        </motion.div>
    );
}

export default memo(AssetCardComponent, (prev, next) => {
    // 基础变更判定
    if (prev.mode !== next.mode) return false;
    if (prev.asset.code !== next.asset.code) return false;
    if (prev.asset.name !== next.asset.name) return false;
    if (prev.onRemove !== next.onRemove) return false;

    // 波动率模式：仅比对历史数据的最后一条日期（通常一天变一次）
    if (prev.mode === 'volatility') {
        const prevDate = prev.asset.history?.at(-1)?.date;
        const nextDate = next.asset.history?.at(-1)?.date;
        return prevDate === nextDate;
    }

    /* 
       实时模式备注：
       价格和分时数据现在由 QuotesContext 注入，不在 props.asset 中。
       AssetCard 内部会通过 useQuotes() 自动重渲染该卡片。
       因此 memo 只需要保证资产结构本身没变即可。
    */
    return true;
});
