'use client';

import { useState, useEffect, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import VolatilityChart from './VolatilityChart';
import IntradayChart from './IntradayChart';
import { calculatePerformance } from '@/lib/utils';
import { useAssetData } from '@/hooks/useAssetData';
import { fetchBulkHistory } from '@/services/api/historyService';
import { fetchBulkIntradayData } from '@/services/api/intradayService';

// 独立子组件，展示具体时段的表现
function MetricPanel({ label, value, history = [], days }) {
    const isPositive = value >= 0;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
                <span className="text-sm font-bold opacity-40 uppercase tracking-tighter">{label}表现</span>
                <span className={`text-base font-mono font-bold ${isPositive ? 'text-red-400' : 'text-green-400'}`}>
                    {isPositive ? '+' : ''}{value?.toFixed(2)}%
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
                <div className="h-[80px] flex items-center justify-center text-white/20 text-xs italic bg-white/5 rounded-lg">
                    数据加载中…
                </div>
            )}
        </div>
    );
}

function AssetCardComponent({ asset, onRemove, mode = 'volatility' }) {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef(null);

    // 监听进入视口，实现真正的懒加载请求
    useEffect(() => {
        const obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                obs.disconnect();
            }
        }, { rootMargin: '200px' });
        if (containerRef.current) obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    // 1. 历史数据获取 (仅在 volatility 模式且可见时启用)
    const { data: historyData } = useAssetData(
        `hist:${asset.type}:${asset.code}`,
        () => fetchBulkHistory([{ code: asset.code, type: asset.type }], false).then(res => res[`${asset.type}:${asset.code}`]),
        { enabled: isVisible && mode === 'volatility' }
    );

    // 2. 分时数据获取 (仅在 realtime 模式且可见时启用，开启自动轮询 2 分钟)
    const { data: intradayData, isValidating: isIntraValidating } = useAssetData(
        `intra:${asset.type}:${asset.code}`,
        () => fetchBulkIntradayData([{ code: asset.code, type: asset.type }], true).then(res => res[asset.code]),
        {
            enabled: isVisible && mode === 'realtime',
            refreshInterval: 120000 // 2 分钟更新一次
        }
    );

    const history = (historyData?.history?.length > 0) ? historyData.history : (asset.history ?? []);
    const summary = (historyData?.history?.length > 0) ? historyData.summary : (asset.summary ?? { perf5d: 0, perf22d: 0, perf250d: 0 });
    const intraPoints = intradayData?.points ?? [];


    const l5 = summary.perf5d;
    const l22 = summary.perf22d;
    const l250 = summary.perf250d;


    const isPositiveChange = (asset.changePercent ?? 0) >= 0;

    return (
        <motion.div
            ref={containerRef}
            layout
            id={`asset-${asset.code}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
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
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-20">今日分时</span>
                        <div className="flex gap-3">
                            <div className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                <span className="text-[9px] font-bold opacity-30">价格</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1">
                        {asset.type === 'fund' ? (
                            <div className="h-[200px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                                <span className="italic">场外基金不支持分时数据</span>
                            </div>
                        ) : intraPoints.length > 0 ? (
                            <IntradayChart
                                data={intraPoints}
                                prevClose={asset.prevClose || intradayData?.prevClose || asset.price}
                                height={200}
                            />
                        ) : isIntraValidating ? (
                            <div className="h-[200px] flex flex-col items-center justify-center text-white/20 text-sm gap-2 bg-white/5 rounded-xl border border-white/5">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                    className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full"
                                />
                                <span className="italic">行情数据同步中，请稍候...</span>
                            </div>
                        ) : (
                            <div className="h-[200px] flex items-center justify-center text-white/20 text-sm bg-white/5 rounded-xl border border-white/5">
                                <span className="italic">暂无今日分时数据</span>
                            </div>
                        )}
                    </div>
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
        prev.asset.code === next.asset.code &&
        prev.asset.price === next.asset.price &&
        prev.asset.changePercent === next.asset.changePercent &&
        // 修复：比对最新时间或最新值而不是固定长度来感知变动 (如滑动窗口)
        prev.asset.history?.[prev.asset.history.length - 1]?.date === next.asset.history?.[next.asset.history.length - 1]?.date &&
        prev.asset.intraday?.price === next.asset.intraday?.price
    );
});
