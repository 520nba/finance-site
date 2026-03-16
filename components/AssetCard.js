'use client';

import { useState, useEffect, useRef, memo, useMemo } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import VolatilityChart from './VolatilityChart';
import IntradayChart from './IntradayChart';
import { calculatePerformance } from '@/lib/utils';
import { fetchBulkHistory } from '@/services/api/historyService';
import { fetchBulkIntradayData } from '@/services/api/intradayService';

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

function AssetCardComponent({ asset, onRemove, mode = 'volatility' }) {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef(null);

    // 监听进入视口，实现延迟实例化与数据拉取
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

    // 取得 localStorage 中的缓存作为首屏 fallback
    const cachedHistory = useMemo(() => {
        try { return JSON.parse(localStorage.getItem(`tracker_cache_hist:${asset.type}:${asset.code}`)) }
        catch { return undefined }
    }, [asset.type, asset.code]);

    const cachedIntraday = useMemo(() => {
        try { return JSON.parse(localStorage.getItem(`tracker_cache_intra:${asset.type}:${asset.code}`)) }
        catch { return undefined }
    }, [asset.type, asset.code]);

    // 1. 历史数据获取 (仅在 volatility 模式且可见时启用)
    const { data: historyData } = useSWR(
        isVisible && mode === 'volatility' ? `hist:${asset.type}:${asset.code}` : null,
        () => fetchBulkHistory([{ code: asset.code, type: asset.type }], false).then(res => res[`${asset.type}:${asset.code}`]),
        {
            fallbackData: cachedHistory,
            revalidateOnFocus: false, // 历史数据不随切换 Tab 刷新
            onSuccess: (data) => {
                if (data) localStorage.setItem(`tracker_cache_hist:${asset.type}:${asset.code}`, JSON.stringify(data));
            }
        }
    );

    // 2. 分时数据获取 (仅在 realtime 模式且可见时启用，自动轮询 2 分钟)
    const { data: intradayData, isValidating: isIntraValidating } = useSWR(
        isVisible && mode === 'realtime' ? `intra:${asset.type}:${asset.code}` : null,
        () => fetchBulkIntradayData([{ code: asset.code, type: asset.type }], true).then(res => res[asset.code]),
        {
            fallbackData: cachedIntraday,
            refreshInterval: 120000,
            onSuccess: (data) => {
                if (data) localStorage.setItem(`tracker_cache_intra:${asset.type}:${asset.code}`, JSON.stringify(data));
            }
        }
    );

    const history = (historyData?.history?.length > 0) ? historyData.history : (asset.history ?? []);
    // 修改：初始值设为 null，防止 +0.00% 的误导 (High Prio Fix)
    const summary = (historyData?.summary) ?? (asset.summary ?? { perf5d: null, perf22d: null, perf250d: null });
    const isHistorySyncing = historyData?.status === 'syncing';

    const intraPoints = intradayData?.points ?? [];
    const isPositiveChange = (asset.changePercent ?? 0) >= 0;

    return (
        <motion.div
            ref={containerRef}
            layout
            id={`asset-${asset.code}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} // 移除 scale 以防止 layout 动画抖动 (Low Prio Fix)
            className="glass-effect p-4 lg:p-5 group"
        >
            <div className="flex justify-between items-center mb-4">
                <div className="flex-1 min-w-0 mr-4">
                    <h3 className="text-lg font-black italic truncate whitespace-nowrap leading-tight">
                        {asset.name}
                    </h3>
                    {mode === 'realtime' && (
                        <p className={`text-sm font-mono font-bold mt-0.5 ${isPositiveChange ? 'text-red-400' : 'text-green-400'}`}>
                            {isPositiveChange ? '+' : ''}{asset.changePercent?.toFixed(2)}%
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => onRemove(asset.code)}
                        aria-label="删除资产"
                        className="p-1.5 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {mode === 'realtime' ? (
                <div className="mt-2">

                    <div className="flex-1">
                        {asset.type === 'fund' ? (
                            <div className="h-[120px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                                <span className="italic">场外基金不支持分时数据</span>
                            </div>
                        ) : (intraPoints.length > 0 && (asset.prevClose || intradayData?.prevClose)) ? (
                            <IntradayChart
                                data={intraPoints}
                                // 修复：移除 asset.price 强制回退，防止误导性的分时渲染 (Mid Prio Fix)
                                prevClose={asset.prevClose || intradayData?.prevClose}
                                height={120}
                            />
                        ) : isIntraValidating ? (
                            <div className="h-[120px] flex flex-col items-center justify-center text-white/20 text-sm gap-2 bg-white/5 rounded-xl border border-white/5">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                    className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full"
                                />
                                <span className="italic">行情数据同步中，请稍候...</span>
                            </div>
                        ) : (
                            <div className="h-[120px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                                <span className="italic">今日暂无分时交易数据</span>
                            </div>
                        )}
                    </div>
                </div>
            ) : isHistorySyncing ? (
                <div className="h-[100px] flex flex-col items-center justify-center gap-3 bg-white/5 rounded-xl border border-dashed border-white/10">
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="w-5 h-5 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full"
                    />
                    <span className="text-xs font-bold text-cyan-500/60 uppercase tracking-widest italic animate-pulse">
                        历史行情同步中 (后台任务)...
                    </span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-white/5">
                    <MetricPanel label="5日" value={summary.perf5d} history={history} days={5} />
                    <MetricPanel label="22日" value={summary.perf22d} history={history} days={22} />
                    <MetricPanel label="250日" value={summary.perf250d} history={history} days={250} />
                </div>
            )}
        </motion.div>
    );
}

export default memo(AssetCardComponent, (prev, next) => {
    return (
        prev.mode === next.mode &&
        prev.onRemove === next.onRemove && // 接入函数比对，防止闭包失效 (High Prio Fix)
        prev.asset.code === next.asset.code &&
        prev.asset.name === next.asset.name &&
        prev.asset.price === next.asset.price &&
        prev.asset.changePercent === next.asset.changePercent &&
        prev.asset.history?.[prev.asset.history.length - 1]?.date === next.asset.history?.[next.asset.history.length - 1]?.date &&
        prev.asset.intraday?.price === next.asset.intraday?.price
    );
});
