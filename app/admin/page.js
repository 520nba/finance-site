'use client';

import { useState, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Trash2, Users, ShieldAlert, Activity, PieChart, TrendingUp, RefreshCcw,
    LogOut, Code, FileText, Wifi, Zap, Database, BarChart3, Clock, LayoutGrid
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Admin Dashboard - Integrated Command Center
 * 整合了用户管理、数据库统计、系统日志以及外部 API 健康监控。
 */
export default function AdminPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#050510] flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/10 border-t-cyan-500 rounded-full animate-spin" />
            </div>
        }>
            <AdminCommandCenter />
        </Suspense>
    );
}

function AdminCommandCenter() {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState({
        users: 0,
        stocks: 0,
        funds: 0,
        history_points: 0,
        intraday_points: 0,
        quotes_count: 0,
        recent_growth: 0,
        queue_count: 0,
        api_health: []
    });
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [secretKey, setSecretKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [toast, setToast] = useState(null);
    const [activeSection, setActiveSection] = useState('overview'); // overview, users, logs, health, queue
    const [queueData, setQueueData] = useState([]);
    const [queueLoading, setQueueLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null); // { message, onConfirm, critical }
    const [currentTime, setCurrentTime] = useState(new Date());
    const router = useRouter();
    const searchParamsHooks = useSearchParams();
    const urlKey = searchParamsHooks.get('key') || searchParamsHooks.get('token');

    // ── 1. 时钟驱动 (Low Prio Fix) ──────────────────────────────────────────
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // ── 2. 安全鉴权与 URL 洗消 (High Prio Fix) ─────────────────────────────────
    useEffect(() => {
        const cachedKey = sessionStorage.getItem('tracker_admin_secret');
        const finalKey = urlKey || cachedKey;

        if (finalKey) {
            setSecretKey(finalKey);
            sessionStorage.setItem('tracker_admin_secret', finalKey);

            // 如果密钥来自 URL，执行地址栏洗消，防止泄露到历史记录或 Logs
            if (urlKey) {
                const newUrl = window.location.pathname;
                window.history.replaceState({}, '', newUrl);
            }

            fetchAllData(finalKey);
        }
    }, [urlKey]);

    useEffect(() => {
        if (activeSection === 'queue') {
            fetchQueue();
        }
    }, [activeSection, fetchQueue]);

    const showToast = useCallback((msg, type = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // ── 3. 函数进行 useCallback 封装 (Mid Prio Fix) ──────────────────────────
    const fetchQueue = useCallback(async () => {
        if (!secretKey) return;
        setQueueLoading(true);
        try {
            // URL 传参已移除，仅通过 Header 传递 Secret (Security Fix)
            const res = await fetch('/api/admin/queue', {
                headers: { 'x-admin-key': secretKey }
            });
            if (res.ok) {
                const data = await res.json();
                setQueueData(data.queue || []);
            }
        } catch (e) {
            console.error('Failed to fetch queue:', e);
            showToast('获取队列失败');
        } finally {
            setQueueLoading(false);
        }
    }, [secretKey, showToast]);

    const fetchAllData = useCallback(async (keyToUse, forceSyncStats = false) => {
        const k = keyToUse || secretKey;
        if (!k) return;
        setLoading(true);

        try {
            const statsUrl = forceSyncStats ? '/api/admin/stats?sync=true' : '/api/admin/stats';
            const usersUrl = '/api/user/list';
            const logsUrl = '/api/admin/logs?hours=72';

            const headers = { 'x-admin-key': k };

            const [usersRes, statsRes, logsRes] = await Promise.all([
                fetch(usersUrl, { headers }),
                fetch(statsUrl, { headers }),
                fetch(logsUrl, { headers })
            ]);

            if (statsRes.ok) {
                const statsData = await statsRes.json();
                setStats(prev => ({ ...prev, ...statsData }));
                setIsAuthenticated(true);
            }

            if (usersRes.ok) {
                const usersData = await usersRes.json();
                setUsers(usersData);
            }

            if (logsRes.ok) {
                const logsData = await logsRes.json();
                setLogs(logsData.logs?.slice(0, 500) || []);
            }

            if (!statsRes.ok && !usersRes.ok) {
                showToast('鉴权失败: 密钥无效或无权限');
                setIsAuthenticated(false);
            }
        } catch (e) {
            console.error('[Admin] Fetch failed:', e);
            showToast('无法连接服务器');
        } finally {
            setLoading(false);
        }
    }, [secretKey, showToast]);

    const deleteUser = async (targetUserId) => {
        setConfirmAction({
            message: `!! 危险警报 !!\n\n你即将对用户 "${targetUserId}" 及其相关的资产记录进行物理抹除。\n\n此操作不可逆。确认执行？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    // 敏感 Token 移出 URL (Security Fix)
                    const res = await fetch('/api/user/delete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-admin-key': secretKey
                        },
                        body: JSON.stringify({ targetUserId }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`主体 [${targetUserId}] 已被终止`, 'success');
                        fetchAllData(secretKey);
                    } else {
                        showToast(data.error || '抹除失败');
                    }
                } catch (e) {
                    showToast('通信错误');
                } finally {
                    setLoading(false);
                    setConfirmAction(null);
                }
            }
        });
    };

    const handleLogout = () => {
        sessionStorage.removeItem('tracker_admin_secret');
        setIsAuthenticated(false);
        setSecretKey('');
    };

    const triggerForceSync = async (type) => {
        const typeZh = type === 'fund' ? '基金' : '股票';
        setConfirmAction({
            message: `!! 协议强制覆盖 !!\n\n系统将从外部节点重新同步所有 ${typeZh} 的历史 K 线，这将替换当前的本地数据集。\n\n执行指令？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    // Token 移出 URL (Security Fix)
                    const res = await fetch('/api/admin/force-sync', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-admin-key': secretKey
                        },
                        body: JSON.stringify({ type })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`[成功] 任务已注入队列\n${data.message}`, 'success');
                        await fetchAllData(secretKey, true);
                    } else {
                        showToast(data.error || '指令被拒绝');
                    }
                } catch (e) {
                    showToast('API 链路中断');
                } finally {
                    setLoading(false);
                    setConfirmAction(null);
                }
            }
        });
    };

    const triggerCleanup = async () => {
        setConfirmAction({
            message: `!! 环境全量洗消 !!\n\n系统将扫描并清理 D1 数据库中所有失效的无主行情数据，以优化背板性能。\n\n继续执行？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    const res = await fetch('/api/admin/cleanup', {
                        method: 'POST',
                        headers: { 'x-admin-key': secretKey }
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`区域清理完成！\n历史: -${data.deleted_hist}, 名称: -${data.deleted_names}`, 'success');
                        fetchAllData(secretKey);
                    } else {
                        showToast(data.error || '洗消任务失败');
                    }
                } catch (e) {
                    showToast('链路请求超时');
                } finally {
                    setLoading(false);
                    setConfirmAction(null);
                }
            }
        });
    };

    return (
        <main className="min-h-screen bg-[#050510] relative text-white selection:bg-cyan-500/30 font-sans overflow-x-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 blur-[120px] rounded-full" />
            </div>

            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.9 }}
                        className={`fixed top-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] font-mono text-sm border border-white/10 backdrop-blur-2xl whitespace-pre-wrap max-w-lg
                            ${toast.type === 'error' ? 'bg-red-500/20 text-red-400 border-red-500/20' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20'}`}
                    >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${toast.type === 'error' ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'}`} />
                        <span className="leading-relaxed">{toast.msg}</span>
                    </motion.div>
                )}

                {confirmAction && (
                    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/80 backdrop-blur-md"
                            onClick={() => !confirmAction.critical && setConfirmAction(null)}
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative bg-black/90 border border-white/10 p-10 rounded-[3rem] max-w-md w-full shadow-[0_0_100px_rgba(0,0,0,1)] overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-amber-500" />
                            <h3 className="text-xl font-black italic uppercase mb-6 tracking-tighter">指令授权确认</h3>
                            <p className="text-white/40 text-sm mb-10 whitespace-pre-wrap leading-relaxed font-medium uppercase tracking-wider">{confirmAction.message}</p>
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setConfirmAction(null)}
                                    className="flex-1 px-6 py-4 rounded-2xl bg-white/5 hover:bg-white/10 font-bold text-[10px] uppercase tracking-widest transition-all"
                                >
                                    返回
                                </button>
                                <button
                                    onClick={confirmAction.onConfirm}
                                    className="flex-1 px-6 py-4 rounded-2xl bg-red-600 hover:bg-red-500 font-black uppercase tracking-[0.2em] text-[10px] shadow-xl shadow-red-600/10 transition-all text-white"
                                >
                                    确认执行
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {!isAuthenticated ? (
                <div className="flex flex-col items-center justify-center min-h-screen px-4">
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-lg p-12 bg-black/40 border border-white/5 rounded-[3rem] backdrop-blur-3xl shadow-2xl relative overflow-hidden"
                    >
                        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600" />
                        <div className="flex flex-col items-center text-center">
                            <div className="w-24 h-24 bg-blue-500/10 rounded-3xl flex items-center justify-center mb-8 rotate-12 group-hover:rotate-0 transition-transform duration-500">
                                <ShieldAlert size={42} className="text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)]" />
                            </div>
                            <h2 className="text-3xl font-black tracking-tighter italic uppercase mb-3">首席调度中心</h2>
                            <p className="text-white/30 text-sm mb-10 leading-relaxed font-medium uppercase tracking-[0.15em]">
                                基础设施与 API 健康巡检控制台<br />
                                <span className="opacity-50 font-mono text-[10px]">[受保护权限 - 仅限核心管理员]</span>
                            </p>
                            <div className="w-full space-y-6">
                                <div className="space-y-2 text-left">
                                    <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 ml-2">身份鉴权密钥</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••••••••••"
                                        value={secretKey}
                                        onChange={(e) => setSecretKey(e.target.value)}
                                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-6 py-5 outline-none focus:border-cyan-500/50 focus:bg-white/5 transition-all font-mono text-center text-xl tracking-[0.3em]"
                                        onKeyDown={(e) => e.key === 'Enter' && fetchAllData(secretKey)}
                                    />
                                </div>
                                <button
                                    onClick={() => fetchAllData(secretKey)}
                                    disabled={loading}
                                    className="w-full bg-blue-600 hover:bg-cyan-500 text-white rounded-2xl py-5 font-black uppercase tracking-widest shadow-xl shadow-blue-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-3"
                                >
                                    {loading ? <RefreshCcw size={20} className="animate-spin" /> : '建立通信连接'}
                                </button>
                                <button onClick={() => router.push('/')} className="w-full py-4 text-white/20 hover:text-white/60 text-[10px] font-black uppercase tracking-[0.4em] transition-all">
                                    &larr; 返回系统主界面
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            ) : (
                <div className="flex h-screen overflow-hidden">
                    {/* Sidebar Navigation */}
                    <aside className="w-20 md:w-72 border-r border-white/5 bg-black/20 backdrop-blur-xl flex flex-col pt-10">
                        <div className="px-6 mb-12 flex items-center gap-4">
                            <div className="w-10 h-10 bg-cyan-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(8,145,178,0.4)]">
                                <Code size={20} className="text-white" />
                            </div>
                            <div className="hidden md:block">
                                <h1 className="text-lg font-black italic tracking-tighter uppercase leading-none">Command</h1>
                                <p className="text-[9px] font-bold opacity-30 uppercase tracking-[0.2em] mt-1">控制中心 v2.0</p>
                            </div>
                        </div>

                        <nav className="flex-1 px-4 space-y-2">
                            {[
                                { id: 'overview', icon: <LayoutGrid size={20} />, label: '概览面板' },
                                { id: 'health', icon: <Wifi size={20} />, label: '接口哨兵' },
                                { id: 'queue', icon: <RefreshCcw size={20} />, label: '同步队列' },
                                { id: 'users', icon: <Users size={20} />, label: '用户审计' },
                                { id: 'logs', icon: <FileText size={20} />, label: '系统日志' },
                            ].map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveSection(item.id)}
                                    className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all group ${activeSection === item.id ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20' : 'text-white/40 hover:bg-white/5 hover:text-white/80'}`}
                                >
                                    <div className={`${activeSection === item.id ? 'text-white' : 'text-white/20 group-hover:text-white/60'}`}>
                                        {item.icon}
                                    </div>
                                    <span className="hidden md:block font-bold text-sm tracking-tight">{item.label}</span>
                                </button>
                            ))}
                        </nav>

                        <div className="p-4 border-t border-white/5 mb-6">
                            <button onClick={handleLogout} className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-red-500/50 hover:bg-red-500/10 hover:text-red-500 transition-all font-bold">
                                <LogOut size={20} />
                                <span className="hidden md:block text-sm">注销通信</span>
                            </button>
                        </div>
                    </aside>

                    {/* Main Content Area */}
                    <main className="flex-1 overflow-y-auto bg-[#050510] custom-scrollbar">
                        <header className="sticky top-0 z-50 flex items-center justify-between px-10 py-6 bg-[#050510]/80 backdrop-blur-md border-b border-white/5">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-emerald-500/10 rounded-full">
                                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                </div>
                                <span className="text-xs font-mono font-black uppercase tracking-widest text-white/40">节点状态: 正常运行</span>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="hidden lg:flex items-center gap-1 border border-white/5 px-4 py-2 rounded-xl bg-white/[0.02]">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-white/20 mr-2">快速操作:</span>
                                    <button onClick={() => fetchAllData(secretKey, true)} title="刷新并校准计数器" className={`p-1.5 hover:text-cyan-400 transition-colors ${loading ? 'animate-spin opacity-50' : ''}`}><RefreshCcw size={16} /></button>
                                    <div className="w-px h-3 bg-white/10 mx-1" />
                                    <button onClick={() => triggerForceSync('stock')} disabled={loading} title="重刷所有股票历史数据" className="p-1.5 hover:text-emerald-400 disabled:opacity-30 transition-colors flex items-center gap-1.5 group/btn">
                                        <TrendingUp size={16} className="group-hover/btn:scale-110 transition-transform" />
                                        <span className="text-[9px] font-black uppercase tracking-tighter hidden xl:inline">股票重刷</span>
                                    </button>
                                    <div className="w-px h-3 bg-white/10 mx-1" />
                                    <button onClick={() => triggerForceSync('fund')} disabled={loading} title="重刷所有基金历史数据" className="p-1.5 hover:text-blue-400 disabled:opacity-30 transition-colors flex items-center gap-1.5 group/btn">
                                        <PieChart size={16} className="group-hover/btn:scale-110 transition-transform" />
                                        <span className="text-[9px] font-black uppercase tracking-tighter hidden xl:inline">基金重刷</span>
                                    </button>
                                    <div className="w-px h-3 bg-white/10 mx-1" />
                                    <button onClick={triggerCleanup} title="全量环境洗消" className="p-1.5 hover:text-orange-400 transition-colors"><Zap size={16} /></button>
                                </div>
                                <div className="text-[10px] font-mono font-bold text-white/20 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
                                    {currentTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}
                                </div>
                            </div>
                        </header>

                        <div className="p-10 max-w-[1200px] mx-auto">
                            <AnimatePresence mode="wait">
                                {activeSection === 'overview' && (
                                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key="overview" className="space-y-12">
                                        {/* Key Stats Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {[
                                                { label: '注册账户', value: stats.users ?? 0, icon: <Users size={18} />, color: 'text-blue-400', bg: 'from-blue-500/10', id: 'users' },
                                                { label: '总资产数', value: ((stats.stocks ?? 0) + (stats.funds ?? 0)), icon: <Zap size={18} />, color: 'text-yellow-400', bg: 'from-yellow-500/10', id: 'assets' },
                                                { label: '待处理队列', value: stats.queue_count ?? 0, icon: <RefreshCcw size={18} />, color: 'text-orange-400', bg: 'from-orange-500/10', id: 'queue' },
                                                { label: '历史数据总量', value: (((stats.history_points ?? 0) / 1000).toFixed(1)) + 'K', icon: <Database size={18} />, color: 'text-emerald-400', bg: 'from-emerald-500/10', id: 'history' },
                                            ].map((kpi, i) => (
                                                <div
                                                    key={i}
                                                    onClick={() => kpi.id === 'queue' && setActiveSection('queue')}
                                                    className={`bg-gradient-to-br ${kpi.bg} to-transparent border border-white/5 p-8 rounded-[2.5rem] relative overflow-hidden group hover:border-white/10 transition-all ${kpi.id === 'queue' ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
                                                >
                                                    <div className={`p-3 w-fit rounded-2xl bg-white/5 mb-6 ${kpi.color}`}>
                                                        {kpi.icon}
                                                    </div>
                                                    <div className="text-4xl font-black italic tracking-tighter mb-1 font-mono">{kpi.value}</div>
                                                    <div className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em]">{kpi.label}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}

                                {activeSection === 'health' && (
                                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="health">
                                        <div className="flex items-center justify-between mb-8 px-2">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400">
                                                    <Wifi size={24} />
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl font-black italic uppercase tracking-tighter">全栈巡检实时监测中心</h2>
                                                    <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em]">
                                                        外部金融协议心跳数据监测 ({stats.api_health?.length || 0} 已连接节点)
                                                        {stats.api_health?.length > 0 && (
                                                            <span className="ml-2 text-cyan-500/40">
                                                                • 最后心跳: {
                                                                    (() => {
                                                                        const timestamps = stats.api_health
                                                                            .map(a => a.heartbeat_ts ? new Date(a.heartbeat_ts + 'Z').getTime() : 0)
                                                                            .filter(t => t > 0);
                                                                        if (timestamps.length === 0) return '无记录';
                                                                        return new Date(Math.max(...timestamps))
                                                                            .toLocaleString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                                                    })()
                                                                }
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-cyan-500/60">
                                                <Clock size={12} /> 实时遥测中
                                            </div>
                                        </div>

                                        <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-white/5 bg-white/[0.01]">
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30">协议与通道</th>
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 text-center">状态</th>
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 text-right">成功率</th>
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 text-right">延迟</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.02]">
                                                    {stats?.api_health && stats.api_health.length > 0 ? (
                                                        stats.api_health.map((api) => {
                                                            const parts = api.api_name.split(':');
                                                            const type = parts.length > 1 ? parts[0] : 'Other';
                                                            const mainName = parts.length > 1 ? parts[1].trim() : api.api_name;
                                                            const typeColor =
                                                                type === 'Hist' ? 'from-purple-500/20 text-purple-400' :
                                                                    type === 'Quote' ? 'from-emerald-500/20 text-emerald-400' :
                                                                        type === 'Intra' ? 'from-blue-500/20 text-blue-400' :
                                                                            type === 'Name' ? 'from-orange-500/20 text-orange-400' : 'from-gray-500/20 text-gray-400';

                                                            return (
                                                                <tr key={api.api_name} className="group hover:bg-white/[0.02] transition-colors">
                                                                    <td className="px-10 py-6">
                                                                        <div className="flex items-center gap-4">
                                                                            <div className={`px-2 py-0.5 rounded bg-gradient-to-r ${typeColor} text-[8px] font-black uppercase tracking-widest border border-white/5`}>
                                                                                {type}
                                                                            </div>
                                                                            <div className="flex flex-col">
                                                                                <span className="font-bold text-base text-white/80 group-hover:text-cyan-400 transition-colors tracking-tight truncate max-w-[240px]">
                                                                                    {mainName}
                                                                                </span>
                                                                                <span className="text-[9px] text-white/20 mt-0.5 uppercase font-mono tracking-widest truncate max-w-[200px] italic">
                                                                                    {api.error_msg || 'Heartbeat Optimal'}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-10 py-6">
                                                                        <div className="flex justify-center">
                                                                            {api.status === 'healthy' ? (
                                                                                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[9px] font-black uppercase tracking-tighter border border-emerald-500/20">
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                                                    健康
                                                                                </div>
                                                                            ) : api.status === 'wary' ? (
                                                                                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-full text-[9px] font-black uppercase tracking-tighter border border-yellow-500/20">
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                                                                                    延迟
                                                                                </div>
                                                                            ) : api.status === 'slow' ? (
                                                                                <div className="flex items-center gap-2 px-3 py-1 bg-orange-500/10 text-orange-400 rounded-full text-[9px] font-black uppercase tracking-tighter border border-orange-500/20">
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                                                                                    不稳定
                                                                                </div>
                                                                            ) : api.status === 'critical' ? (
                                                                                <div className="flex items-center gap-2 px-3 py-1 bg-red-600/10 text-red-500 rounded-full text-[9px] font-black uppercase tracking-tighter border border-red-600/20">
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-bounce" />
                                                                                    严重错误
                                                                                </div>
                                                                            ) : (
                                                                                <div className="flex items-center gap-2 px-3 py-1 bg-red-900/20 text-red-700 rounded-full text-[9px] font-black uppercase tracking-tighter border border-red-900/30">
                                                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-900" />
                                                                                    离线
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-10 py-6 text-right">
                                                                        <span className="font-mono font-black text-xl text-white/50 group-hover:text-white transition-colors">{api.success_rate}</span>
                                                                    </td>
                                                                    <td className="px-10 py-6 text-right font-mono">
                                                                        <span className={`font-black text-base ${(api.avg_latency ?? 0) > 3000 ? 'text-red-400' : (api.avg_latency ?? 0) > 1500 ? 'text-yellow-400' : 'text-white/40 group-hover:text-white/80'}`}>{api.avg_latency ?? '--'}</span>
                                                                        <span className="text-[9px] opacity-20 ml-1 font-black">ms</span>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    ) : (
                                                        <tr><td colSpan="4" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm group">正在等待巡检心跳信号<span className="inline-block animate-bounce ml-2">...</span></td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                )}

                                {activeSection === 'users' && (
                                    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} key="users">
                                        <div className="flex items-center gap-4 mb-8">
                                            <div className="p-3 bg-red-500/10 rounded-2xl text-red-400">
                                                <Users size={24} />
                                            </div>
                                            <div>
                                                <h2 className="text-2xl font-black italic uppercase tracking-tighter">主体审计与权限管理</h2>
                                                <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.1em]">已注册实体账户数据库分布情况</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {users.length > 0 ? (
                                                users.map(u => (
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
                                                            onClick={() => deleteUser(u)}
                                                            className="p-4 bg-red-500/5 text-red-500/30 hover:bg-red-500 hover:text-white rounded-2xl transition-all shadow-xl shadow-red-500/0 hover:shadow-red-500/20"
                                                            title="粉碎账户"
                                                        >
                                                            <Trash2 size={20} />
                                                        </button>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="col-span-full py-40 flex flex-col items-center justify-center text-white/10 italic group">
                                                    <FileText size={64} className="mb-4 opacity-5 group-hover:opacity-10 transition-opacity" />
                                                    <p className="uppercase tracking-[0.4em] font-black text-xs">当前扇区未发现活跃主体</p>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}

                                {activeSection === 'logs' && (
                                    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} key="logs">
                                        <div className="flex items-center justify-between mb-8">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400">
                                                    <FileText size={24} />
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl font-black italic uppercase tracking-tighter">系统脉搏记录</h2>
                                                    <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.15em]">时序活动追踪 (最近 72 小时窗口)</p>
                                                </div>
                                            </div>
                                            <div className="px-5 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full text-[10px] font-black text-blue-400 uppercase tracking-widest animate-pulse">实时遥测中</div>
                                        </div>

                                        <div className="bg-white/[0.01] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl lg:p-4">
                                            <div className="max-h-[600px] overflow-y-auto custom-scrollbar px-6 py-4">
                                                {logs.length > 0 ? (
                                                    <div className="space-y-1">
                                                        {logs.map((log) => (
                                                            <div key={log.id || `${log.timestamp}-${log.module}`} className="group flex flex-col md:flex-row gap-4 py-2 px-5 rounded-xl hover:bg-white/[0.02] border border-transparent hover:border-white/5 transition-all">
                                                                <div className="flex items-center gap-4 min-w-[150px]">
                                                                    <div className={`w-1 h-1 rounded-full ${log.level === 'INFO' ? 'bg-blue-500' : log.level === 'WARN' ? 'bg-orange-500' : 'bg-red-500'}`} />
                                                                    <span className="text-[10px] font-mono font-bold text-white/20">
                                                                        {new Date(log.timestamp + 'Z').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                                                                    </span>
                                                                </div>
                                                                <div className="flex-1 flex gap-4">
                                                                    <span className="text-[9px] font-black px-2 py-0.5 bg-white/5 rounded-md text-white/40 uppercase tracking-widest h-fit">[{log.module}]</span>
                                                                    <p className="text-[11px] font-medium text-white/60 leading-tight group-hover:text-white/90 transition-colors uppercase tracking-tight">{log.message}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="py-40 flex flex-col items-center justify-center text-white/10 italic">
                                                        <Activity size={48} className="mb-4 opacity-5 animate-pulse" />
                                                        <p className="font-black uppercase tracking-[0.4em] text-xs">正在等待背板信号...</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {activeSection === 'queue' && (
                                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key="queue">
                                        <div className="flex items-center justify-between mb-8 px-2">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-orange-500/10 rounded-2xl text-orange-400">
                                                    <RefreshCcw size={24} />
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl font-black italic uppercase tracking-tighter">待处理任务队列</h2>
                                                    <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em]">当前 D1 节点正在等待调度或同步中的任务清单</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={async () => {
                                                        setQueueLoading(true);
                                                        try {
                                                            const res = await fetch('/api/cron/sync', { headers: { 'x-admin-key': secretKey } });
                                                            const data = await res.json();
                                                            showToast(data.message || '指令已送达', 'success');
                                                            await fetchQueue();
                                                            await fetchAllData(secretKey, true);
                                                        } catch (e) {
                                                            showToast('手动触发失败');
                                                        } finally {
                                                            setQueueLoading(false);
                                                        }
                                                    }}
                                                    disabled={queueLoading}
                                                    className={`flex items-center gap-2 px-6 py-3 rounded-2xl border transition-all group ${(stats.queue_count || 0) > 0 ? 'bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 border-cyan-500/10' : 'bg-white/5 text-white/20 border-white/5 cursor-not-allowed'}`}
                                                >
                                                    <Zap size={14} className={queueLoading ? 'animate-pulse' : ''} />
                                                    <span className="text-[10px] font-black uppercase tracking-widest">
                                                        手动消化批处理 {(stats.queue_count || 0) > 0 ? `(剩余 ${stats.queue_count})` : '(已排空)'}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setConfirmAction({
                                                            title: '清空同步队列？',
                                                            message: `确定要作废当前所有待同步任务吗？这不会删除已有的历史数据，但会停止当前的后台更新。`,
                                                            onConfirm: async () => {
                                                                setQueueLoading(true);
                                                                try {
                                                                    const res = await fetch('/api/admin/queue/clear', {
                                                                        method: 'POST',
                                                                        headers: { 'x-admin-key': secretKey }
                                                                    });
                                                                    const data = await res.json();
                                                                    showToast(data.message || '队列已清空', 'success');
                                                                    await fetchQueue();
                                                                    await fetchAllData(secretKey, true);
                                                                } catch (e) {
                                                                    showToast('清空队列失败');
                                                                } finally {
                                                                    setQueueLoading(false);
                                                                }
                                                            }
                                                        });
                                                    }}
                                                    disabled={queueLoading || (stats.queue_count || 0) === 0}
                                                    title="一键清空待处理队列"
                                                    className={`p-3 rounded-2xl border transition-all ${(stats.queue_count || 0) > 0 ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/10' : 'bg-white/5 text-white/10 border-white/5 cursor-not-allowed'}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                <button
                                                    onClick={fetchQueue}
                                                    disabled={queueLoading}
                                                    className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group"
                                                >
                                                    <RefreshCcw size={14} className={`text-white/40 group-hover:text-white/80 ${queueLoading ? 'animate-spin' : ''}`} />
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-white/60 group-hover:text-white/90">立即刷新清单</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-white/5 bg-white/[0.01]">
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30">资产代码</th>
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30">类型</th>
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 text-center">状态</th>
                                                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-white/30 text-right">时间</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.02]">
                                                    {queueLoading && !queueData.length ? (
                                                        <tr>
                                                            <td colSpan="4" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm group">
                                                                正在从 D1 提取队列清单<span className="inline-block animate-bounce ml-2">...</span>
                                                            </td>
                                                        </tr>
                                                    ) : queueData.length > 0 ? (
                                                        queueData.map((item) => (
                                                            <tr key={item.id || `${item.code}-${item.type}-${item.created_at}`} className="group hover:bg-white/[0.02] transition-colors">
                                                                <td className="px-10 py-6 font-mono text-lg font-bold text-white/80 group-hover:text-orange-400 transition-colors tracking-tight">
                                                                    {item.code}
                                                                </td>
                                                                <td className="px-10 py-6">
                                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border border-white/5 ${item.type === 'fund' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                                                        {item.type === 'fund' ? '基金' : '股票'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-10 py-6">
                                                                    <div className="flex justify-center">
                                                                        {item.status === 'pending' ? (
                                                                            <div className="px-3 py-1 bg-white/5 text-white/30 rounded-full text-[9px] font-black uppercase tracking-tighter border border-white/10">
                                                                                等待中
                                                                            </div>
                                                                        ) : item.status === 'syncing' ? (
                                                                            <div className="flex items-center gap-2 px-3 py-1 bg-orange-500/10 text-orange-400 rounded-full text-[9px] font-black uppercase tracking-tighter border border-orange-500/20">
                                                                                <div className="w-1 h-1 rounded-full bg-orange-400 animate-pulse" />
                                                                                同步中
                                                                            </div>
                                                                        ) : (
                                                                            <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[9px] font-black uppercase tracking-tighter border border-emerald-500/20">
                                                                                完成
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-10 py-6 text-right font-mono text-[10px] text-white/20 group-hover:text-white/60 transition-colors">
                                                                    {new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan="4" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm group">
                                                                当前核心队列已清空
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </main>
                </div>
            )}
        </main>
    );
}
