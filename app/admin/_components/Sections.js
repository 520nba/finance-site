'use client';

import { motion } from 'framer-motion';
import {
    Users, Wifi, RefreshCcw, FileText, LayoutGrid,
    Database, Zap, Activity, Clock, Trash2, PieChart, TrendingUp, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useState, useMemo } from 'react';

// ── OverviewSection ───────────────────────────────────────────────────────

export function OverviewSection({ stats, onNavigate, onForceSync, onCleanup, loading }) {
    const kpis = [
        { label: '注册账户', value: stats.users ?? 0, icon: <Users size={18} />, color: 'text-blue-400', bg: 'from-blue-500/10', id: 'users' },
        { label: '总资产数', value: (stats.stocks ?? 0) + (stats.funds ?? 0), icon: <Zap size={18} />, color: 'text-yellow-400', bg: 'from-yellow-500/10', id: 'assets' },
        { label: '待处理队列', value: stats.queue_count ?? 0, icon: <RefreshCcw size={18} />, color: 'text-orange-400', bg: 'from-orange-500/10', id: 'queue' },
        { label: '历史数据总量', value: `${((stats.history_points ?? 0) / 1000).toFixed(1)}K`, icon: <Database size={18} />, color: 'text-emerald-400', bg: 'from-emerald-500/10', id: 'history' },
    ];

    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {kpis.map((kpi, i) => (
                    <div
                        key={i}
                        onClick={() => kpi.id === 'queue' && onNavigate('queue')}
                        className={`bg-gradient-to-br ${kpi.bg} to-transparent border border-white/5 p-8
                            rounded-[2.5rem] relative overflow-hidden group hover:border-white/10 transition-all
                            ${kpi.id === 'queue' ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
                    >
                        <div className={`p-3 w-fit rounded-2xl bg-white/5 mb-6 ${kpi.color}`}>{kpi.icon}</div>
                        <div className="text-4xl font-black italic tracking-tighter mb-1 font-mono">{kpi.value}</div>
                        <div className="text-xs text-white/30 font-bold uppercase tracking-[0.2em]">{kpi.label}</div>
                    </div>
                ))}
            </div>

            {/* Maintenance Section Integration */}
            <div className="mt-12 bg-white/[0.02] border border-white/5 rounded-[3rem] p-10 flex flex-col lg:flex-row items-center justify-between gap-8 group hover:border-cyan-500/20 transition-all">
                <div className="flex items-center gap-6">
                    <div className="p-4 bg-cyan-500/10 rounded-[1.5rem] text-cyan-400">
                        <RefreshCcw size={32} className={loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-700'} />
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-xl font-black italic uppercase tracking-tight">底层数据热重置</h3>
                        <p className="text-xs text-white/30 max-w-md leading-relaxed">
                            强制从外部节点全量同步 365 天历史 K 线数据，并对齐北京时区。
                            本操作将覆盖数据库现有记录，用于<b>修复日期偏移或数据缺失</b>。
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4 w-full lg:w-auto">
                    <button
                        onClick={() => onForceSync('fund')}
                        disabled={loading}
                        className="flex-1 lg:flex-none px-8 py-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-cyan-600/20 active:scale-95 flex items-center justify-center gap-2"
                    >
                        <PieChart size={14} /> 基金重刷
                    </button>
                    <button
                        onClick={onCleanup}
                        disabled={loading}
                        className="flex-1 lg:flex-none px-8 py-4 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/60 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <Zap size={14} /> 深度洗消
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

// ── HealthSection ─────────────────────────────────────────────────────────

const TYPE_COLOR = {
    Hist: 'from-purple-500/20 text-purple-400',
    Quote: 'from-emerald-500/20 text-emerald-400',
    Intra: 'from-blue-500/20 text-blue-400',
    Name: 'from-orange-500/20 text-orange-400',
};

export function HealthSection({ apiHealth }) {
    return (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="health">
            <div className="flex items-center justify-between mb-8 px-2">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400"><Wifi size={24} /></div>
                    <div>
                        <h2 className="text-2xl font-black italic uppercase tracking-tighter">全栈巡检实时监测中心</h2>
                        <p className="text-xs text-white/20 font-bold uppercase tracking-[0.2em]">
                            外部金融协议心跳数据监测 ({apiHealth?.length || 0} 已连接节点)
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-cyan-500/60">
                    <Clock size={12} /> 实时遥测中
                </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/5 bg-white/[0.01]">
                            {['协议与通道', '状态', '成功率', '延迟'].map((h, i) => (
                                <th key={h} className={`px-10 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 ${i > 1 ? 'text-right' : i === 1 ? 'text-center' : ''}`}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02]">
                        {apiHealth?.length > 0 ? apiHealth.map((api) => {
                            const [type, ...rest] = api.api_name.split(':');
                            const mainName = rest.length ? rest.join(':').trim() : api.api_name;
                            const typeColor = TYPE_COLOR[type] || 'from-gray-500/20 text-gray-400';
                            return (
                                <tr key={api.api_name} className="group hover:bg-white/[0.02] transition-colors">
                                    <td className="px-10 py-6">
                                        <div className="flex items-center gap-4">
                                            <div className={`px-2 py-0.5 rounded bg-gradient-to-r ${typeColor} text-[10px] font-black uppercase tracking-widest border border-white/5`}>{type}</div>
                                            <div className="flex flex-col">
                                                <span className="font-bold text-base text-white/80 group-hover:text-cyan-400 transition-colors tracking-tight truncate max-w-[240px]">{mainName}</span>
                                                <span className="text-[11px] text-white/20 mt-0.5 uppercase font-mono tracking-widest italic">{api.error_msg || 'Heartbeat Optimal'}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-10 py-6">
                                        <div className="flex justify-center">
                                            {api.status === 'healthy' ? (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[11px] font-black uppercase tracking-tighter border border-emerald-500/20">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />健康
                                                </div>
                                            ) : api.status === 'critical' ? (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-red-600/10 text-red-500 rounded-full text-[11px] font-black uppercase tracking-tighter border border-red-600/20">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-bounce" />故障
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-full text-[11px] font-black uppercase tracking-tighter border border-yellow-500/20">延迟</div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-10 py-6 text-right">
                                        <span className="font-mono font-black text-xl text-white/50 group-hover:text-white transition-colors">{api.success_rate}</span>
                                    </td>
                                    <td className="px-10 py-6 text-right font-mono">
                                        <span className={`font-black text-base ${(api.avg_latency ?? 0) > 3000 ? 'text-red-400' : (api.avg_latency ?? 0) > 1500 ? 'text-yellow-400' : 'text-white/40 group-hover:text-white/80'}`}>
                                            {api.avg_latency ?? '--'}
                                        </span>
                                        <span className="text-[11px] opacity-20 ml-1 font-black">ms</span>
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr><td colSpan="4" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm">正在等待巡检心跳信号</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}

// ── UsersSection ──────────────────────────────────────────────────────────

export function UsersSection({ users, onDeleteUser }) {
    return (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} key="users">
            <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-red-500/10 rounded-2xl text-red-400"><Users size={24} /></div>
                <div>
                    <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">主体审计与权限管理</h2>
                    <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.1em]">已注册实体账户数据库分布情况</p>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {users.length > 0 ? users.map(u => (
                    <div key={u} className="group p-8 bg-white/[0.02] border border-white/5 rounded-[2.5rem] flex items-center justify-between hover:border-red-500/30 transition-all hover:bg-white/[0.04]">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-white/5 flex items-center justify-center font-black text-xl italic text-white/40 shadow-xl group-hover:from-gray-700 group-hover:text-cyan-400 transition-all">
                                {u.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div className="font-mono text-xl font-bold tracking-tight text-white/80 group-hover:text-white transition-colors">{u}</div>
                                <div className="text-[9px] text-white/20 font-bold uppercase tracking-widest mt-1">哈希校验：已激活</div>
                            </div>
                        </div>
                        <button
                            onClick={() => onDeleteUser(u)}
                            className="p-4 bg-red-500/5 text-red-500/30 hover:bg-red-500 hover:text-white rounded-2xl transition-all shadow-xl shadow-red-500/0 hover:shadow-red-500/20"
                        >
                            <Trash2 size={20} />
                        </button>
                    </div>
                )) : (
                    <div className="col-span-full py-40 flex flex-col items-center justify-center text-white/10 italic group">
                        <FileText size={64} className="mb-4 opacity-5" />
                        <p className="uppercase tracking-[0.4em] font-black text-xs">当前扇区未发现活跃主体</p>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

// ── LogsSection ───────────────────────────────────────────────────────────

export function LogsSection({ logs }) {
    return (
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} key="logs">
            <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400"><FileText size={24} /></div>
                <div>
                    <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">系统脉搏记录</h2>
                    <p className="text-xs text-white/20 font-bold uppercase tracking-[0.15em]">时序活动追踪 (最近 72 小时窗口)</p>
                </div>
            </div>
            <div className="bg-white/[0.01] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl lg:p-4">
                <div className="max-h-[600px] overflow-y-auto custom-scrollbar px-6 py-4">
                    {logs.length > 0 ? (
                        <div className="space-y-1">
                            {logs.map(log => (
                                <div
                                    key={log.id || `${log.timestamp}-${log.module}`}
                                    className="group flex flex-col md:flex-row gap-4 py-2 px-5 rounded-xl hover:bg-white/[0.02] border border-transparent hover:border-white/5 transition-all"
                                >
                                    <div className="flex items-center gap-4 min-w-[200px]">
                                        <div className={`w-1 h-1 rounded-full ${log.level === 'INFO' ? 'bg-blue-500' : log.level === 'WARN' ? 'bg-orange-500' : 'bg-red-500'}`} />
                                        <span className="text-xs font-mono font-bold text-white/30">
                                            {new Date(log.timestamp + 'Z').toLocaleString('zh-CN', {
                                                timeZone: 'Asia/Shanghai',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                                hour12: false,
                                            })}
                                        </span>
                                    </div>
                                    <div className="flex-1 flex gap-4">
                                        <span className="text-[11px] font-black px-2 py-0.5 bg-white/5 rounded-md text-white/40 uppercase tracking-widest h-fit">[{log.module}]</span>
                                        <p className="text-xs font-medium text-white/60 leading-tight group-hover:text-white/90 transition-colors uppercase tracking-tight">{log.message}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-40 flex flex-col items-center justify-center text-white/10 italic text-center">
                            <Activity size={48} className="mb-4 opacity-5 animate-pulse mx-auto" />
                            <p className="font-black uppercase tracking-[0.4em] text-xs">正在等待背板信号...</p>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

// ── QueueSection ──────────────────────────────────────────────────────────

// ── QueueSection ──────────────────────────────────────────────────────────

export function QueueSection({ queueData, onRefresh, loading }) {
    const [sortConfig, setSortConfig] = useState({ key: 'updated_at', direction: 'desc' });
    const [filterStatus, setFilterStatus] = useState('all');

    const statusMap = {
        pending: { label: '排队中', color: 'text-white/40', bg: 'bg-white/5' },
        processing: { label: '同步中', color: 'text-blue-400', bg: 'bg-blue-400/10' },
        completed: { label: '已完成', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
        failed: { label: '已失败', color: 'text-red-400', bg: 'bg-red-400/10' },
    };

    const sortedAndFilteredData = useMemo(() => {
        let items = [...queueData];
        if (filterStatus !== 'all') {
            items = items.filter(item => item.status === filterStatus);
        }
        items.sort((a, b) => {
            const valA = a[sortConfig.key] || '';
            const valB = b[sortConfig.key] || '';
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        return items;
    }, [queueData, sortConfig, filterStatus]);

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
                        <p className="text-xs text-white/20 font-bold uppercase tracking-[0.2em]">当前 D1 节点正在等待调度或同步中的任务清单 (仅存 300 条)</p>
                    </div>
                    <button
                        onClick={onRefresh}
                        disabled={loading}
                        className="ml-4 p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/40 hover:text-white/80 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none group"
                        title="立即刷新列表"
                    >
                        <RefreshCcw size={16} className={`${loading ? 'animate-spin' : ''} group-hover:rotate-180 transition-transform duration-500`} />
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase text-white/20 tracking-widest mr-2">状态筛选</span>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white/80 outline-none focus:border-white/20 transition-all cursor-pointer"
                    >
                        <option value="all">全量显示</option>
                        <option value="pending">排队中 (Pending)</option>
                        <option value="processing">同步中 (Processing)</option>
                        <option value="completed">已完成 (Completed)</option>
                        <option value="failed">已失败 (Failed)</option>
                    </select>
                </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5 bg-white/[0.01]">
                                <th className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30">资产名称</th>
                                <th className="px-8 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30">代码</th>
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
                                return (
                                    <tr key={item.id} className="group hover:bg-white/[0.02] transition-colors">
                                        <td className="px-8 py-6 font-bold text-white/80 text-sm whitespace-nowrap">{item.name || '未知资产'}</td>
                                        <td className="px-8 py-6 font-mono text-xs text-white/40">{item.code}</td>
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
                                    <td colSpan="5" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm">
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

// ── AssetStatusSection ───────────────────────────────────────────────────

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
