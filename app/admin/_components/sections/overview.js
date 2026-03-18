'use client';

import { motion } from 'framer-motion';
import { Users, Zap, RefreshCcw, Database, PieChart, Clock } from 'lucide-react';

export function OverviewSection({ stats, onNavigate, onForceSync, onCleanup, onFullSync, loading }) {
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
                        className="flex-1 lg:flex-none px-8 py-4 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/60 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <Zap size={14} /> 深度洗消
                    </button>
                    <button
                        onClick={onFullSync}
                        disabled={loading}
                        className="flex-1 lg:flex-none px-8 py-4 bg-orange-600/20 hover:bg-orange-600/40 border border-orange-500/20 disabled:opacity-50 text-orange-400 rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <Clock size={14} /> 模拟 Cron
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
