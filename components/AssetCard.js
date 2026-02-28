'use client';

import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import VolatilityChart from './VolatilityChart';
import IntradayChart from './IntradayChart';
import LazyChart from './LazyChart';
import { calculatePerformance } from '@/lib/utils';

// 独立子组件，展示具体时段的表现
function MetricPanel({ label, value, history, days }) {
    const isPositive = value >= 0;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
                <span className="text-sm font-bold opacity-40 uppercase tracking-tighter">{label}表现</span>
                <span className={`text-base font-mono font-bold ${isPositive ? 'text-red-400' : 'text-green-400'}`}>
                    {isPositive ? '+' : ''}{value.toFixed(2)}%
                </span>
            </div>
            <LazyChart height={80}>
                {history.length > 0 ? (
                    <VolatilityChart
                        data={calculatePerformance(history, days)}
                        title={label}
                        color={isPositive ? '#ef4444' : '#10b981'}
                        height={80}
                        compact={true}
                    />
                ) : (
                    <div className="h-[80px] flex items-center justify-center text-white/20 text-xs italic">
                        历史数据加载中…
                    </div>
                )}
            </LazyChart>
        </div>
    );
}

import { memo } from 'react';

function AssetCardComponent({ asset, onRemove, mode = 'volatility' }) {
    const history = asset.history ?? [];
    const summary = asset.summary ?? { perf5d: 0, perf22d: 0, perf250d: 0 };

    const l5 = summary.perf5d;
    const l22 = summary.perf22d;
    const l250 = summary.perf250d;

    const isPositive = (asset.changePercent ?? 0) >= 0;

    return (
        <motion.div
            layout
            id={`asset-${asset.code}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="glass-effect p-6 group"
        >
            <div className="flex justify-between items-start mb-6">
                <div className="flex-1">
                    <h3 className="text-2xl font-black flex items-baseline italic gap-3 mb-1">
                        {asset.name}
                        <span className="text-xs font-mono font-normal opacity-30 not-italic tracking-widest">{asset.code}</span>
                    </h3>
                    <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isPositive ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                            {asset.type === 'stock' ? '股票' : '基金'}
                        </span>
                        {mode === 'realtime' && (
                            <span className="text-[10px] font-mono opacity-20 uppercase tracking-widest">实时数据已激活</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-8">
                    <div className="text-right">
                        <p className="text-3xl font-mono font-bold tracking-tighter leading-none mb-1">
                            {asset.price?.toFixed(asset.type === 'fund' ? 4 : 2)}
                        </p>
                        {mode === 'realtime' && (
                            <p className={`text-sm font-mono font-bold ${isPositive ? 'text-red-400' : 'text-green-400'}`}>
                                {isPositive ? '+' : ''}{asset.changePercent?.toFixed(2)}%
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => onRemove(asset.code)}
                        aria-label="删除资产"
                        className="p-2 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>

            {mode === 'realtime' ? (
                <div className="mt-4">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold uppercase tracking-widest opacity-20">今日分时线</span>
                        <div className="flex gap-4">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                <span className="text-[10px] font-bold opacity-30">价格走势</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 border border-dashed border-white/20"></span>
                                <span className="text-[10px] font-bold opacity-30">昨日收盘</span>
                            </div>
                        </div>
                    </div>
                    <IntradayChart
                        data={asset.intraday?.points}
                        prevClose={asset.intraday?.prevClose || asset.price}
                        height={320}
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <MetricPanel label="5日" value={l5} history={history} days={5} />
                    <MetricPanel label="22日" value={l22} history={history} days={22} />
                    <MetricPanel label="250日" value={l250} history={history} days={250} />
                </div>
            )}
        </motion.div>
    );
}

// 深度优化：防止每 60 秒轮询无脑推平整个卡片组件的 DOM
export default memo(AssetCardComponent, (prev, next) => {
    return (
        prev.mode === next.mode &&
        prev.asset.code === next.asset.code &&
        prev.asset.price === next.asset.price &&
        prev.asset.changePercent === next.asset.changePercent &&
        // 如果分时最后一个点的 price 相同，大概率无需重载图表
        prev.asset.intraday?.price === next.asset.intraday?.price
    );
});
