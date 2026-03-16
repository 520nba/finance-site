'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Activity, Wifi, WifiOff, Zap, BarChart3, Database, RefreshCw, TrendingUp, PieChart } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export default function AdminDashboard({ isOpen, onClose }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null); // { type, message, onConfirm }

    const [toast, setToast] = useState(null);
    const showToast = (msg, type = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const searchParams = useSearchParams();

    const fetchStats = useCallback(async (forceSync = false) => {
        setLoading(true);
        try {
            const key = searchParams.get('key') || searchParams.get('token') || sessionStorage.getItem('tracker_admin_secret');
            const headers = key ? { 'x-admin-key': key } : {};

            const url = new URL(forceSync ? '/api/admin/stats?sync=true' : '/api/admin/stats', window.location.origin);

            const res = await fetch(url.toString(), { headers });
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            } else if (res.status === 403) {
                showToast('未授权：请检查您的管理员密钥。');
            }
        } catch (e) {
            console.error('Failed to fetch admin stats:', e);
            showToast('连接被拒绝');
        } finally {
            setLoading(false);
        }
    }, [searchParams, stats]); // stats is used to avoid refetching if already present in useEffect, but fetchStats itself replaces it.


    useEffect(() => {
        if (isOpen) {
            if (!stats) fetchStats();
        }
    }, [isOpen, stats, fetchStats]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/95 backdrop-blur-xl"
            />

            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.9 }}
                        className={`fixed top-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl font-mono text-sm border border-white/10 backdrop-blur-2xl whitespace-pre-wrap max-w-lg
                            ${toast.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}
                    >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                        {toast.msg}
                    </motion.div>
                )}

                {confirmAction && (
                    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                            onClick={() => setConfirmAction(null)}
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="relative bg-[#111] border border-white/10 p-8 rounded-[2rem] max-w-md w-full shadow-2xl"
                        >
                            <h3 className="text-xl font-black italic uppercase mb-4 text-cyan-400">需要指令授权</h3>
                            <p className="text-white/60 text-sm mb-8 whitespace-pre-wrap leading-relaxed">{confirmAction.message}</p>
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setConfirmAction(null)}
                                    className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 font-bold text-sm transition-all"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={confirmAction.onConfirm}
                                    className="flex-1 px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-black uppercase tracking-widest text-sm shadow-lg shadow-cyan-600/20 transition-all text-white"
                                >
                                    确认执行
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 40 }}
                className="relative w-full max-w-6xl h-[90vh] bg-[#050505] border border-white/10 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,1)] overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-10 py-8 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-5">
                            <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.1)]">
                                <ShieldCheck size={28} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none mb-1">首席调度中心</h2>
                                <p className="text-[10px] text-white/20 uppercase tracking-[0.3em] font-bold">终端节点：D1-MATRIX-01</p>
                            </div>
                        </div>

                    </div>

                    <div className="flex items-center gap-6">

                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-[10px] text-white/20 font-black uppercase tracking-widest leading-none mb-1">系统心跳</span>
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                                <span className="text-xs font-mono font-bold text-cyan-500/80 uppercase tracking-tighter">ENCRYPTED</span>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-full transition-all group">
                            <X size={24} className="opacity-30 group-hover:opacity-100" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                    {loading && !stats ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4 opacity-20">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                                className="w-12 h-12 border-2 border-white/10 border-t-white/60 rounded-full"
                            />
                            <p className="font-black italic tracking-[0.5em] uppercase text-sm">正在同步矩阵数据...</p>
                        </div>
                    ) : (
                        <div className="space-y-12">
                            {/* Key Performance Indicators */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                {[
                                    { label: '活跃用户', value: stats?.users ?? 0, icon: <Activity size={18} />, color: 'text-blue-400' },
                                    { label: '资产总量', value: ((stats?.stocks ?? 0) + (stats?.funds ?? 0)), icon: <Zap size={18} />, color: 'text-yellow-400' },
                                    { label: '历史点位', value: (((stats?.history_points ?? 0) / 1000).toFixed(1)) + 'K', icon: <Database size={18} />, color: 'text-purple-400' }
                                ].map((kpi, i) => (
                                    <div key={i} className="bg-white/[0.03] border border-white/5 p-6 rounded-3xl group hover:border-white/10 transition-all relative">
                                        <div className="absolute top-6 right-6">
                                            {i === 0 && (
                                                <button
                                                    onClick={() => fetchStats(true)}
                                                    disabled={loading}
                                                    title="手动校准计数器 (消耗 D1 读取)"
                                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/30 hover:text-white/60"
                                                >
                                                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                                                </button>
                                            )}
                                        </div>
                                        <div className={`p-2 w-fit rounded-lg bg-white/5 mb-4 ${kpi.color}`}>
                                            {kpi.icon}
                                        </div>
                                        <div className="text-3xl font-black italic tracking-tighter mb-1">{kpi.value || '--'}</div>
                                        <div className="text-[10px] text-white/20 font-bold uppercase tracking-widest">{kpi.label}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Section: API Realtime Health Monitoring */}
                            <div>
                                <div className="flex items-center justify-between mb-6 px-2">
                                    <div className="flex items-center gap-3">
                                        <Wifi size={18} className="text-cyan-500" />
                                        <h3 className="text-sm font-black italic uppercase tracking-widest text-white/60">外部协议巡检反馈</h3>
                                    </div>
                                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-tighter">采样率: 5分钟</span>
                                </div>

                                <div className="bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-white/5 bg-white/[0.01]">
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">接口与通道名称</th>
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 text-center">协议状态</th>
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 text-right">成功率</th>
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 text-right">平均延迟</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.03]">
                                            {stats?.api_health?.length ? (
                                                stats.api_health.map((api) => (
                                                    <tr key={api.api_name} className="group hover:bg-white/[0.02] transition-colors">
                                                        <td className="px-8 py-6">
                                                            <div className="flex flex-col">
                                                                <span className="font-bold text-white/80 group-hover:text-cyan-400 transition-colors uppercase tracking-tight">{api.api_name}</span>
                                                                <span className="text-[9px] text-white/20 mt-1 uppercase font-mono">{api.error_msg || '协议接口运行正常'}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-8 py-6">
                                                            <div className="flex justify-center">
                                                                {api.status === 'healthy' ? (
                                                                    <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-[10px] font-black uppercase tracking-tighter border border-green-500/20">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
                                                                        正常健康
                                                                    </div>
                                                                ) : api.status === 'wary' ? (
                                                                    <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-full text-[10px] font-black uppercase tracking-tighter border border-yellow-500/20">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500"></div>
                                                                        响应延迟
                                                                    </div>
                                                                ) : api.status === 'slow' ? (
                                                                    <div className="flex items-center gap-2 px-3 py-1 bg-orange-500/10 text-orange-500 rounded-full text-[10px] font-black uppercase tracking-tighter border border-orange-500/20">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                                                                        波动不稳定
                                                                    </div>
                                                                ) : api.status === 'critical' ? (
                                                                    <div className="flex items-center gap-2 px-3 py-1 bg-red-600/10 text-red-500 rounded-full text-[10px] font-black uppercase tracking-tighter border border-red-600/20">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-bounce"></div>
                                                                        严重故障
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2 px-3 py-1 bg-red-900/20 text-red-700 rounded-full text-[10px] font-black uppercase tracking-tighter border border-red-900/30">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-red-900"></div>
                                                                        离线断开
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-8 py-6 text-right">
                                                            <span className="font-mono font-black text-lg text-white/60">{api.success_rate ?? '0/0'}</span>
                                                        </td>
                                                        <td className="px-8 py-6 text-right">
                                                            <span className={`font-mono font-black ${(api.avg_latency ?? 0) > 3000 ? 'text-red-400' : (api.avg_latency ?? 0) > 1500 ? 'text-yellow-400' : 'text-white/40'}`}>{api.avg_latency ?? '--'}ms</span>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan="4" className="px-8 py-12 text-center text-white/10 italic text-sm font-black uppercase tracking-widest">
                                                        {loading ? '正在解密心跳信号...' : '等待巡检组件响应...'}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-10 py-6 border-t border-white/5 bg-white/[0.01] flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.3em]">遥测链路状态: 建立连接</span>
                        <div className="w-1 h-1 rounded-full bg-cyan-500/40"></div>
                        <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.3em] font-mono">{new Date().toLocaleTimeString()}</span>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
