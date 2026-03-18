'use client';

import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { calculatePerformance } from '@/lib/utils';
import { fetchBulkHistory } from '@/lib/api/client/historyService';
import { useQuotes } from '@/providers/AssetProvider';

// 鈹€鈹€ 杈呭姪鍑芥暟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

function SortIcon({ colKey, sortKey, sortDesc }) {
    if (sortKey !== colKey) return <ChevronsUpDown size={10} className="opacity-30" />;
    return sortDesc
        ? <ChevronDown size={10} className="text-cyan-400" />
        : <ChevronUp size={10} className="text-cyan-400" />;
}

const COLS = [
    { key: 'd5', label: '5鏃? },
    { key: 'd22', label: '22鏃? },
    { key: 'd250', label: '250鏃? },
];

/**
 * 鈹€鈹€ 1. 瀹炴椂鐩戞帶妯″紡缁勪欢 (璁㈤槄楂橀 QuotesContext) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
 */
function WatchlistRealtimeMode({ assets, selectedCode, onSelect, scrollToAsset }) {
    const { quotesMap } = useQuotes();
    const [sortKey, setSortKey] = useState('changePercent');
    const [sortDesc, setSortDesc] = useState(true);

    const rows = useMemo(() => assets.map(asset => {
        const q = quotesMap[asset.code.toLowerCase()];
        return {
            ...asset,
            price: q ? q.price : asset.price,
            changePercent: q ? q.changePercent : asset.changePercent
        };
    }), [assets, quotesMap]);

    const sorted = useMemo(() => {
        return [...rows].sort((a, b) => {
            const av = a[sortKey] ?? null;
            const bv = b[sortKey] ?? null;
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return sortDesc ? bv - av : av - bv;
        });
    }, [rows, sortKey, sortDesc]);

    return (
        <div className="border-t border-white/5">
            <div className="flex items-center px-4 py-1.5 border-b border-white/5 gap-3">
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest opacity-25">鍚嶇О</span>
                <span className="w-20 text-right text-[10px] font-bold uppercase tracking-widest opacity-25">鐜颁环</span>
                <button
                    onClick={() => { if (sortKey === 'changePercent') setSortDesc(!sortDesc); else { setSortKey('changePercent'); setSortDesc(true); } }}
                    className="w-16 flex items-center justify-end gap-0.5 text-right text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-80 transition-opacity cursor-pointer"
                >
                    娑ㄨ穼骞?
                    <SortIcon colKey="changePercent" sortKey={sortKey} sortDesc={sortDesc} />
                </button>
            </div>
            <div className="max-h-[300px] lg:max-h-[75vh] overflow-y-auto custom-scrollbar">
                {sorted.map(row => {
                    const isSelected = row.code === selectedCode;
                    return (
                        <button
                            key={row.code}
                            onClick={() => scrollToAsset(row.code)}
                            className={`w-full flex items-center gap-3 px-4 py-2 border-b border-white/5 last:border-0 hover:bg-white/5 active:bg-white/10 transition-all text-left ${isSelected ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : ''}`}
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold leading-tight truncate">{row.name}</p>
                            </div>
                            <div className="w-20 text-right">
                                <p className="text-sm font-mono font-bold leading-tight">
                                    {row.price?.toFixed(row.type === 'fund' ? 4 : 2)}
                                </p>
                            </div>
                            <div className="w-16 text-right">
                                <PerfCell value={row.changePercent ?? null} />
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * 鈹€鈹€ 2. 娉㈠姩鐜囧垎鏋愭ā寮忕粍浠?(涓嶈闃?QuotesContext锛屽畬鍏ㄤ笉鍙楅珮棰戞姤浠峰奖鍝? 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
 */
function WatchlistVolatilityMode({ assets, scrollToAsset }) {
    const [sortKey, setSortKey] = useState('d5');
    const [sortDesc, setSortDesc] = useState(true);
    const [statsData, setStatsData] = useState({});

    const assetKeys = useMemo(() =>
        assets.map(a => `${a.type}:${a.code}`).sort().join(','),
        [assets]);

    useEffect(() => {
        if (assets.length === 0) return;
        const itemsToFetch = assets.map(a => ({ code: a.code, type: a.type }));
        fetchBulkHistory(itemsToFetch, false).then(res => {
            const newStats = {};
            for (const key in res) {
                if (res[key]?.summary) newStats[key] = res[key].summary;
            }
            setStatsData(newStats);
        }).catch(e => console.error("Sidebar bulk fetch failed:", e));
    }, [assetKeys]);

    const rows = useMemo(() => assets.map(asset => {
        const key = `${asset.type}:${asset.code}`;
        const summary = statsData[key] || asset.summary;
        const h = (statsData[key]?.history) || asset.history || [];
        return {
            ...asset,
            d5: summary?.perf5d ?? lastPerf(h, 5),
            d22: summary?.perf22d ?? lastPerf(h, 22),
            d250: summary?.perf250d ?? lastPerf(h, 250),
        };
    }), [assets, statsData]);

    const sorted = useMemo(() => {
        return [...rows].sort((a, b) => {
            const av = a[sortKey] ?? null;
            const bv = b[sortKey] ?? null;
            if (av === null && bv === null) return 0;
            if (av === null) return 1;
            if (bv === null) return -1;
            return sortDesc ? bv - av : av - bv;
        });
    }, [rows, sortKey, sortDesc]);

    const latestDateStr = useMemo(() => {
        let latest = '';
        assets.forEach(a => {
            const key = `${a.type}:${a.code}`;
            const h = (statsData[key]?.history) || a.history || [];
            if (h.length > 0) {
                const d = h[h.length - 1].date;
                if (d > latest) latest = d;
            }
        });
        if (!latest) return '';
        const [y, m, d] = latest.split('-');
        return `(鏇存柊鑷?{parseInt(m)}鏈?{parseInt(d)}鏃?`;
    }, [assets, statsData]);

    return (
        <>
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 opacity-40" />
                <span className="text-xs font-bold uppercase tracking-widest opacity-40">鑷€夋竻鍗曞垎鏋?/span>
                <span className="text-[10px] font-bold text-cyan-400/60 uppercase tracking-tighter ml-1">
                    {latestDateStr}
                </span>
            </div>
            <div className="flex items-center px-4 py-1.5 border-b border-white/5 gap-3">
                <span className="flex-1 text-[10px] font-bold uppercase tracking-widest opacity-25">鍚嶇О</span>
                {COLS.map(col => (
                    <button
                        key={col.key}
                        onClick={() => { if (sortKey === col.key) setSortDesc(!sortDesc); else { setSortKey(col.key); setSortDesc(true); } }}
                        className="w-16 flex items-center justify-end gap-0.5 text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-80 transition-opacity cursor-pointer"
                    >
                        {col.label}
                        <SortIcon colKey={col.key} sortKey={sortKey} sortDesc={sortDesc} />
                    </button>
                ))}
            </div>
            <div className="max-h-[300px] lg:max-h-[75vh] overflow-y-auto custom-scrollbar">
                {sorted.map(row => (
                    <button
                        key={row.code}
                        onClick={() => scrollToAsset(row.code)}
                        className="w-full flex items-center gap-3 px-4 py-2 border-b border-white/5 last:border-0 hover:bg-white/5 active:bg-white/10 transition-all text-left"
                    >
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold leading-tight truncate">{row.name}</p>
                        </div>
                        <PerfCell value={row.d5} />
                        <PerfCell value={row.d22} />
                        <PerfCell value={row.d250} />
                    </button>
                ))}
            </div>
        </>
    );
}

/**
 * 鈹€鈹€ 3. 涓诲嚭鍙ｇ粍浠讹細瀹炵幇鎸夐渶鍒嗗寘娓叉煋 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
 */
export default function WatchlistSidebar({ assets, mode = 'volatility', selectedCode, onSelect }) {
    if (!assets || assets.length === 0) return null;

    const scrollToAsset = (code) => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        if (mode === 'realtime' && onSelect) onSelect(code);

        const el = document.getElementById(`asset-${code}`);
        if (el) {
            const offset = 20;
            const bodyRect = document.body.getBoundingClientRect().top;
            const elementRect = el.getBoundingClientRect().top;
            const elementPosition = elementRect - bodyRect;
            const offsetPosition = elementPosition - offset;
            window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
        }
    };

    return (
        <aside className="w-full lg:w-[380px] lg:flex-shrink-0 lg:sticky lg:top-4 lg:self-start">
            <div className="glass-effect border-white/10 overflow-hidden">
                {mode === 'realtime' ? (
                    <>
                        <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-widest opacity-40">瀹炴椂鐩戞帶</span>
                            <span className="ml-auto text-xs font-mono opacity-20">{assets.length}</span>
                        </div>
                        <WatchlistRealtimeMode
                            assets={assets}
                            selectedCode={selectedCode}
                            onSelect={onSelect}
                            scrollToAsset={scrollToAsset}
                        />
                    </>
                ) : (
                    <WatchlistVolatilityMode
                        assets={assets}
                        scrollToAsset={scrollToAsset}
                    />
                )}
            </div>
        </aside>
    );
}

