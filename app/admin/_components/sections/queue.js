'use client';

import { motion } from 'framer-motion';
import { RefreshCcw, ChevronUp, ChevronDown } from 'lucide-react';
import { useState, useMemo } from 'react';

export function QueueSection({ queueData, onRefresh, loading }) {
    const [sortConfig, setSortConfig] = useState({ key: 'updated_at', direction: 'desc' });
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterType, setFilterType] = useState('all');

    const statusMap = {
        pending: { label: '排队中', color: 'text-white/40', bg: 'bg-white/5' },
        processing: { label: '同步中', color: 'text-blue-400', bg: 'bg-blue-400/10' },
        completed: { label: '已完成', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
        failed: { label: '已失败', color: 'text-red-400', bg: 'bg-red-400/10' },
    };

    const typeMap = {
        'asset_history_sync': { label: '历史', color: 'text-purple-400', bg: 'bg-purple-400/10' },
        'intraday_sync': { label: '分时', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
        'fund_history': { label: '基金', color: 'text-orange-400', bg: 'bg-orange-400/10' },
        'asset_names': { label: '命名', color: 'text-pink-400', bg: 'bg-pink-400/10' },
    };

    const sortedAndFilteredData = useMemo(() => {
        let items = [...queueData];
        if (filterStatus !== 'all') {
            items = items.filter(item => item.status === filterStatus);
        }
        // 由于 API 已经做了 type 过滤，这里的客户端 filterType 可作为辅助或冗余保护
        if (filterType !== 'all') {
            items = items.filter(item => item.type === filterType);
        }
        items.sort((a, b) => {
            const valA = a[sortConfig.key] || '';
            const valB = b[sortConfig.key] || '';
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        return items;
    }, [queueData, sortConfig, filterStatus, filterType]);

    const handleTypeChange = (e) => {
        const newType = e.target.value;
        setFilterType(newType);
        onRefresh(newType); // 调用后端过滤
    };

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key="queue">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 px-2">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-orange-500/10 rounded-2xl text-orange-400"><RefreshCcw size={24} className={loading ? 'animate-spin' : ''} /></div>
                    <div>
                        <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">同步子系统队列</h2>
                        <p className="text-xs text-white/20 font-bold uppercase tracking-[0.2em]">当前 D1 节点正在等待调度或同步中的任务清单 (仅存 600 条)</p>
                    </div>
                    <button
                        onClick={() => onRefresh(filterType)}
                        disabled={loading}
                        className="ml-4 p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/40 hover:text-white/80 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none group"
                        title="立即刷新列表"
                    >
                        <RefreshCcw size={16} className={`${loading ? 'animate-spin' : ''} group-hover:rotate-180 transition-transform duration-500`} />
                    </button>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-white/20 tracking-widest mr-2">任务类型</span>
                        <select
                            value={filterType}
                            onChange={handleTypeChange}
                            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white/80 outline-none focus:border-white/20 transition-all cursor-pointer min-w-[120px]"
                        >
                            <option value="all">全量类型</option>
                            <option value="intraday_sync">日内分时 (Intraday)</option>
                            <option value="asset_history_sync">历史行情 (History)</option>
                            <option value="fund_history">基金历史 (Fund)</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-white/20 tracking-widest mr-2">状态筛选</span>
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white/80 outline-none focus:border-white/20 transition-all cursor-pointer min-w-[100px]"
                        >
                            <option value="all">全量显示</option>
                            <option value="pending">排队中 (Pending)</option>
                            <option value="processing">同步中 (Processing)</option>
                            <option value="completed">已完成 (Completed)</option>
                            <option value="failed">已失败 (Failed)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5 bg-white/[0.01]">
                                <th className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30">资产名称</th>
                                <th className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30">代码</th>
                                <th className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 text-center">类型</th>
                                <th className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 text-center">状态</th>
                                <th
                                    onClick={() => requestSort('created_at')}
                                    className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 text-right cursor-pointer hover:text-white/60 transition-colors"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        加入时间
                                        {sortConfig.key === 'created_at' && (sortConfig.direction === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                                    </div>
                                </th>
                                <th
                                    onClick={() => requestSort('updated_at')}
                                    className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 text-right cursor-pointer hover:text-white/60 transition-colors"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        完成时间
                                        {sortConfig.key === 'updated_at' && (sortConfig.direction === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.02]">
                            {sortedAndFilteredData.length > 0 ? sortedAndFilteredData.map(item => {
                                const st = statusMap[item.status] || { label: item.status, color: 'text-white/20', bg: 'bg-white/5' };
                                const ty = typeMap[item.type] || { label: item.type, color: 'text-white/40', bg: 'bg-white/5' };
                                return (
                                    <tr key={item.id} className="group hover:bg-white/[0.02] transition-colors">
                                        <td className="px-8 py-6 font-bold text-white/80 text-sm whitespace-nowrap">{item.name || '未知资产'}</td>
                                        <td className="px-8 py-6 font-mono text-xs text-white/40">{item.code}</td>
                                        <td className="px-8 py-6 text-center">
                                            <span className={`px-3 py-1 ${ty.bg} ${ty.color} rounded-lg text-[9px] font-bold uppercase tracking-widest`}>
                                                {ty.label}
                                            </span>
                                        </td>
                                        <td className="px-8 py-6 text-center">
                                            <span className={`px-4 py-1.5 ${st.bg} ${st.color} rounded-full text-[10px] font-black uppercase tracking-widest`}>
                                                {st.label}
                                            </span>
                                        </td>
                                        <td className="px-8 py-6 text-right font-mono text-xs text-white/30 whitespace-nowrap">
                                            {item.created_at ? new Date(item.created_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '--:--'}
                                        </td>
                                        <td className="px-8 py-6 text-right font-mono text-xs text-white/50 whitespace-nowrap">
                                            {item.status === 'completed' || item.status === 'failed'
                                                ? new Date(item.updated_at + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                                                : <span className="text-white/5 italic">挂起中...</span>
                                            }
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan="6" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm">
                                        没有符合条件的任务记录
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </motion.div>
    );
}
