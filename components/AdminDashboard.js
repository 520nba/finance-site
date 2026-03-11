'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Activity, Wifi, WifiOff, Zap, BarChart3, Database } from 'lucide-react';

export default function AdminDashboard({ isOpen, onClose }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const url = new URL(window.location.href);
            const key = url.searchParams.get('key') || url.searchParams.get('token');
            const headers = key ? { 'x-admin-key': key } : {};

            const res = await fetch('/api/admin/stats', { headers });
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (e) {
            console.error('Failed to fetch admin stats:', e);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (isOpen) {
            fetchStats();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />

            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 40 }}
                className="relative w-full max-w-6xl h-[90vh] bg-[#050505] border border-white/10 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,1)] overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-10 py-8 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-5">
                        <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.1)]">
                            <ShieldCheck size={28} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black italic tracking-tighter uppercase leading-none mb-1">Chief Command Center</h2>
                            <p className="text-[10px] text-white/20 uppercase tracking-[0.3em] font-bold">Infrastructure & API Health Sentinel</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-[10px] text-white/20 font-black uppercase tracking-widest leading-none mb-1">Node Status</span>
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>
                                <span className="text-xs font-mono font-bold text-cyan-500/80 uppercase tracking-tighter">Operational</span>
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
                            <p className="font-black italic tracking-[0.5em] uppercase text-sm">Syncing Matrix...</p>
                        </div>
                    ) : (
                        <div className="space-y-12">
                            {/* Key Performance Indicators */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                {[
                                    { label: 'Active Users', value: stats?.users, icon: <Activity size={18} />, color: 'text-blue-400' },
                                    { label: 'Total Assets', value: (stats?.stocks + stats?.funds), icon: <Zap size={18} />, color: 'text-yellow-400' },
                                    { label: 'Data Points', value: (stats?.history_points / 1000).toFixed(1) + 'K', icon: <Database size={18} />, color: 'text-purple-400' },
                                    { label: 'DB Engine', value: 'D1/SQLite', icon: <BarChart3 size={18} />, color: 'text-cyan-400' }
                                ].map((kpi, i) => (
                                    <div key={i} className="bg-white/[0.03] border border-white/5 p-6 rounded-3xl group hover:border-white/10 transition-all">
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
                                        <h3 className="text-sm font-black italic uppercase tracking-widest text-white/60">API Sentinel Feedback</h3>
                                    </div>
                                    <span className="text-[10px] font-mono text-white/20 uppercase tracking-tighter">Sampling rate: 5m</span>
                                </div>

                                <div className="bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-white/5 bg-white/[0.01]">
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Interface Name</th>
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 text-center">Protocol Status</th>
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 text-right">Success Rate</th>
                                                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 text-right">Avg Latency</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.03]">
                                            {stats?.api_health?.map((api) => (
                                                <tr key={api.api_name} className="group hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-8 py-6">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-white/80 group-hover:text-cyan-400 transition-colors">{api.api_name}</span>
                                                            <span className="text-[9px] text-white/20 mt-1 uppercase font-mono">{api.error_msg || 'Endpoint Active'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6">
                                                        <div className="flex justify-center">
                                                            {api.status === 'healthy' ? (
                                                                <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-[10px] font-black uppercase tracking-tighter border border-green-500/20">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></div>
                                                                    Healthy
                                                                </div>
                                                            ) : api.status === 'wary' ? (
                                                                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-full text-[10px] font-black uppercase tracking-tighter border border-yellow-500/20">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500"></div>
                                                                    Delayed
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 text-red-500 rounded-full text-[10px] font-black uppercase tracking-tighter border border-red-500/20">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                                                                    Offline
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <span className="font-mono font-black text-lg text-white/60">{api.success_rate}%</span>
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <span className="font-mono font-black text-white/40">{api.avg_latency}ms</span>
                                                    </td>
                                                </tr>
                                            )) || (
                                                    <tr>
                                                        <td colSpan="4" className="px-8 py-12 text-center text-white/10 italic text-sm">Waiting for sentinel heartbeat...</td>
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
                        <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.3em]">Telemetry Active</span>
                        <div className="w-1 h-1 rounded-full bg-white/20"></div>
                        <span className="text-[9px] font-black text-white/10 uppercase tracking-[0.3em]">{new Date().toLocaleTimeString()}</span>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
