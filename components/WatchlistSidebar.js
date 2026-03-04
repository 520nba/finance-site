'use client';

import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { calculatePerformance } from '@/lib/utils';
import { fetchBulkHistory } from '@/services/api/historyService';

// 从历史数据计算最终涨跌幅（单个数字）
function lastPerf(history, days) {
    if (!history || history.length === 0) return null;
    const curve = calculatePerformance(history, days);
    if (curve.length === 0) return null;
    return curve[curve.length - 1].performance;
}

function PerfCell({ value }) {
    if (value === null) return <span className="text-white/20 font-mono text-sm w-16 text-right">--</span>;
    const isPos = value >= 0;
    return (
        <span className={`font-mono text-sm font-bold tabular-nums w-16 text-right ${isPos ? 'text-red-400' : 'text-green-400'}`}>
            {isPos ? '+' : ''}{value.toFixed(1)}%
        </span>
    );
}

const COLS = [
    { key: 'd5', label: '5D' },
    { key: 'd22', label: '22D' },
    { key: 'd250', label: '250D' },
];

function SortIcon({ colKey, sortKey, sortDesc }) {
    if (sortKey !== colKey) return <ChevronsUpDown size={10} className="opacity-30" />;
    return sortDesc
        ? <ChevronDown size={10} className="text-cyan-400" />
        : <ChevronUp size={10} className="text-cyan-400" />;
}

export default function WatchlistSidebar({ assets, mode = 'volatility', selectedCode, onSelect }) {
    const [sortKey, setSortKey] = useState('d5');
    const [sortDesc, setSortDesc] = useState(true);
    const [statsData, setStatsData] = useState({});

    // 每次 assets 变化或进入 volatility 模式时，批量拉取服务端 KV 缓存 (极速响应，不请求外部)
    useEffect(() => {
        if (mode !== 'volatility' || assets.length === 0) return;
        const itemsToFetch = assets.map(a => ({ code: a.code, type: a.type }));
        fetchBulkHistory(itemsToFetch, false).then(res => {
            const newStats = {};
            for (const key in res) {
                if (res[key]?.summary) {
                    newStats[key] = res[key].summary;
                }
            }
            setStatsData(prev => ({ ...prev, ...newStats }));
        }).catch(e => console.error("Sidebar bulk fetch failed:", e));
    }, [assets, mode]);

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDesc(v => !v);
        } else {
            setSortKey(key);
            setSortDesc(true);
        }
    };

    // 预计算每个资产的涨跌幅，优先使用缓存的 summary
    const rows = useMemo(() => assets.map(asset => {
        const key = `${asset.type}:${asset.code}`;
        const summary = statsData[key] || asset.summary;
        const h = asset.history ?? [];
        return {
            ...asset,
            d5: summary?.perf5d ?? lastPerf(h, 5),
            d22: summary?.perf22d ?? lastPerf(h, 22),
            d250: summary?.perf250d ?? lastPerf(h, 250),
        };
    }), [assets, statsData]);

    // 排序：null 值排最后
    const sorted = useMemo(() => {
        return [...rows].sort((a, b) => {
            const av = a[sortKey], bv = b[sortKey];
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return sortDesc ? bv - av : av - bv;
        });
    }, [rows, sortKey, sortDesc]);

    const scrollToAsset = (code) => {
        if (mode === 'realtime') {
            if (onSelect) onSelect(code);
            return;
        }

        const el = document.getElementById(`asset-${code}`);
        if (el) {
            const offset = 20; // 顶部预留一点距离
            const bodyRect = document.body.getBoundingClientRect().top;
            const elementRect = el.getBoundingClientRect().top;
            const elementPosition = elementRect - bodyRect;
            const offsetPosition = elementPosition - offset;

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    };

    if (!assets || assets.length === 0) return null;

    return (
        <aside className="w-full lg:w-[380px] lg:flex-shrink-0 lg:sticky lg:top-4 lg:self-start">
            <div className="glass-effect border-white/10 overflow-hidden">
                {/* Header */}
                <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-widest opacity-40">
                        {mode === 'realtime' ? '实时监控' : '自选清单'}
                    </span>
                    <span className="ml-auto text-xs font-mono opacity-20">{assets.length}</span>
                </div>

                {/* Column headers (only in volatility mode) */}
                {mode === 'volatility' && (
                    <div className="flex items-center px-4 py-1.5 border-b border-white/5 gap-3">
                        <span className="flex-1 text-[10px] font-bold uppercase tracking-widest opacity-25">名称</span>
                        {COLS.map(col => (
                            <button
                                key={col.key}
                                onClick={() => handleSort(col.key)}
                                className="w-16 flex items-center justify-end gap-0.5 text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-80 transition-opacity cursor-pointer"
                            >
                                {col.label}
                                <SortIcon colKey={col.key} sortKey={sortKey} sortDesc={sortDesc} />
                            </button>
                        ))}
                    </div>
                )}

                {/* Row Header for realtime mode */}
                {mode === 'realtime' && (
                    <div className="flex items-center px-4 py-1.5 border-b border-white/5 gap-3">
                        <span className="flex-1 text-[10px] font-bold uppercase tracking-widest opacity-25">代码名称</span>
                        <span className="w-20 text-right text-[10px] font-bold uppercase tracking-widest opacity-25">现价</span>
                        <span className="w-16 text-right text-[10px] font-bold uppercase tracking-widest opacity-25">涨跌幅</span>
                    </div>
                )}

                {/* Asset rows */}
                <div className="max-h-[300px] lg:max-h-[75vh] overflow-y-auto custom-scrollbar">
                    {sorted.map(row => {
                        const isSelected = mode === 'realtime' && row.code === selectedCode;
                        return (
                            <button
                                key={row.code}
                                onClick={() => scrollToAsset(row.code)}
                                className={`w-full flex items-center gap-3 px-4 py-2 border-b border-white/5 last:border-0 hover:bg-white/5 active:bg-white/10 transition-all text-left ${isSelected ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : ''}`}
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold leading-tight truncate">{row.name}</p>
                                    <p className="text-[10px] font-mono opacity-30 uppercase tracking-tighter">{row.code}</p>
                                </div>
                                {mode === 'volatility' ? (
                                    <>
                                        <PerfCell value={row.d5} />
                                        <PerfCell value={row.d22} />
                                        <PerfCell value={row.d250} />
                                    </>
                                ) : (
                                    <>
                                        <div className="w-20 text-right">
                                            <p className="text-sm font-mono font-bold leading-tight">
                                                {row.price?.toFixed(row.type === 'fund' ? 4 : 2)}
                                            </p>
                                        </div>
                                        <div className="w-16 text-right">
                                            <PerfCell value={row.changePercent ?? 0} />
                                        </div>
                                    </>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
}
