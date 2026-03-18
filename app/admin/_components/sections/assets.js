'use client';

import { motion } from 'framer-motion';
import { TrendingUp, RefreshCcw, ChevronUp, ChevronDown } from 'lucide-react';
import { useState, useMemo } from 'react';

export function AssetStatusSection({ assets, onRefresh, loading }) {
    const [sortConfig, setSortConfig] = useState({ key: 'code', direction: 'asc' });

    const sortedAssets = useMemo(() => {
        const items = [...assets];
        if (sortConfig.key) {
            items.sort((a, b) => {
                const aVal = a[sortConfig.key] ?? '';
                const bVal = b[sortConfig.key] ?? '';
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return items;
    }, [assets, sortConfig]);

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const renderSortIcon = (key) => {
        if (sortConfig.key !== key) return <div className="w-3 h-3 ml-1 opacity-0" />;
        return sortConfig.direction === 'asc' ? <ChevronUp size={12} className="ml-1 text-cyan-400" /> : <ChevronDown size={12} className="ml-1 text-cyan-400" />;
    };

    return (
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} key="assets">
            <div className="flex items-center justify-between mb-8 px-2">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400"><TrendingUp size={24} /></div>
                    <div>
                        <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">资产数据存量监控</h2>
                        <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em]">实时监控 D1 物理存储节点数据对齐状态</p>
                    </div>
                </div>
                <button
                    onClick={onRefresh}
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-cyan-600/20 active:scale-95"
                >
                    <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
                    {loading ? '全量检索中...' : '手动同步状态'}
                </button>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/5 bg-white/[0.01]">
                            {[
                                { label: '代码', key: 'code', align: '' },
                                { label: '名称', key: 'name', align: '' },
                                { label: '历史存量', key: 'history_count', align: 'text-center' },
                                { label: '状态', key: 'sync_status', align: 'text-right' },
                                { label: '入库时间', key: 'last_sync', align: 'text-right' }
                            ].map((col) => (
                                <th
                                    key={col.key}
                                    onClick={() => requestSort(col.key)}
                                    className={`px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 cursor-pointer hover:text-white/60 transition-colors ${col.align}`}
                                >
                                    <div className={`flex items-center ${col.align === 'text-center' ? 'justify-center pl-4' : col.align === 'text-right' ? 'justify-end' : ''}`}>
                                        {col.label}
                                        {renderSortIcon(col.key)}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02]">
                        {sortedAssets.length > 0 ? sortedAssets.map(asset => (
                            <tr key={`${asset.code}-${asset.type}`} className="group hover:bg-white/[0.02] transition-colors font-mono">
                                <td className="px-8 py-6">
                                    <span className="font-bold text-white/80 group-hover:text-cyan-400 transition-colors uppercase tracking-tight truncate max-w-[120px]">{asset.code}</span>
                                </td>
                                <td className="px-8 py-6">
                                    <span className="text-xs text-white/40 uppercase font-black tracking-widest truncate max-w-[150px] group-hover:text-white/70 transition-colors">{asset.name || 'Unknown'}</span>
                                </td>
                                <td className="px-8 py-6 text-center">
                                    <span className="px-3 py-1 bg-white/5 rounded-full text-xs font-black text-white/40 group-hover:text-white/80 transition-colors italic">
                                        {asset.history_count} <span className="text-[10px] tracking-tighter">PTS</span>
                                    </span>
                                </td>
                                <td className="px-8 py-6 text-right">
                                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border
                                        ${asset.sync_status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                            asset.sync_status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                asset.sync_status === 'processing' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse' :
                                                    'bg-white/5 text-white/20 border-white/5'}`}>
                                        {asset.sync_status || 'idle'}
                                    </span>
                                </td>
                                <td className="px-8 py-6 text-right text-xs text-white/30 italic uppercase tracking-tighter whitespace-nowrap font-mono">
                                    {asset.last_sync ? new Date(asset.last_sync + 'Z').toLocaleString('zh-CN', {
                                        timeZone: 'Asia/Shanghai',
                                        hour12: false,
                                        month: '2-digit',
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    }) : '--:--'}
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan="5" className="px-10 py-48 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm">点击右上角按钮检索全栈资产对齐状态</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}
