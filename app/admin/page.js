'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Users, ShieldAlert, Activity, PieChart, TrendingUp, RefreshCcw, LogOut, Code, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState({
        users: 0,
        stocks: 0,
        funds: 0,
        history_points: 0,
        intraday_points: 0,
        quotes_count: 0,
        recent_growth: 0
    });
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [secretKey, setSecretKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [toast, setToast] = useState(null);
    const router = useRouter();

    useEffect(() => {
        const cachedKey = sessionStorage.getItem('tracker_admin_secret');
        if (cachedKey) {
            setSecretKey(cachedKey);
            fetchAllData(cachedKey);
        }
    }, []);

    const showToast = (msg, type = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const fetchAllData = async (keyToUse = secretKey) => {
        if (!keyToUse) return showToast('请输入 Server Admin Key');
        setLoading(true);

        try {
            const headers = { 'x-admin-key': keyToUse };
            const [usersRes, statsRes, logsRes] = await Promise.all([
                fetch('/api/user/list', { headers }),
                fetch('/api/admin/stats', { headers }),
                fetch('/api/admin/logs?hours=72', { headers })
            ]);

            if (usersRes.ok && statsRes.ok) {
                const usersData = await usersRes.json();
                const statsData = await statsRes.json();

                setUsers(usersData);
                if (statsData.users !== undefined) setStats(statsData);

                if (logsRes.ok) {
                    const logsData = await logsRes.json();
                    setLogs(logsData.logs || []);
                }

                setIsAuthenticated(true);
                sessionStorage.setItem('tracker_admin_secret', keyToUse);
            } else {
                showToast('鉴权失败: 密钥无效或无权限');
                setIsAuthenticated(false);
                sessionStorage.removeItem('tracker_admin_secret');
            }
        } catch (e) {
            showToast('无法连接服务器');
            setIsAuthenticated(false);
        }
        setLoading(false);
    };

    const deleteUser = async (targetUserId) => {
        if (!confirm(`!! 危险操作 !!\n\n您即将删除用户 "${targetUserId}" 及其所有定制化的自选关联数据。\n\n确认执行吗？（不可逆）`)) return;

        try {
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
                showToast(`已粉碎用户账户 [${targetUserId}]`, 'success');
                fetchAllData();
            } else {
                showToast(data.error || '删除失败');
            }
        } catch (e) {
            showToast('删除请求发出异常');
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem('tracker_admin_secret');
        setIsAuthenticated(false);
        setSecretKey('');
    };

    const triggerCleanup = async () => {
        if (!confirm('确定要扫描全库并删除所有“未被订阅”的僵尸行情数据吗？\n\n此操作会大幅降低 D1 负载并加快 Cron 运行速度。')) return;
        setLoading(true);
        try {
            const res = await fetch('/api/admin/cleanup', {
                method: 'POST',
                headers: { 'x-admin-key': secretKey }
            });
            const data = await res.json();
            if (res.ok) {
                showToast(`清理成功！\n历史: -${data.deleted_hist}, 名称: -${data.deleted_names}`, 'success');
                fetchAllData();
            } else {
                showToast(data.error || '清理任务失败');
            }
        } catch (e) {
            showToast('请求超时或网络异常');
        }
        setLoading(false);
    };

    return (
        <main className="min-h-screen bg-[#050510] relative text-white selection:bg-red-500/30 font-sans overflow-x-hidden pt-8">
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.9 }}
                        className={`fixed top-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-4 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] font-mono text-sm border-l-4 backdrop-blur-md
                            ${toast.type === 'error' ? 'bg-red-950/80 border-red-500 text-red-200' : 'bg-green-950/80 border-green-500 text-green-200'}`}
                    >
                        {toast.msg}
                    </motion.div>
                )}
            </AnimatePresence>

            {!isAuthenticated ? (
                <div className="flex flex-col items-center justify-center min-h-[85vh] px-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full max-w-md p-10 bg-black/40 border border-white/5 rounded-3xl backdrop-blur-xl shadow-2xl relative overflow-hidden"
                    >
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-orange-500" />
                        <div className="flex flex-col items-center text-center">
                            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
                                <ShieldAlert size={36} className="text-red-500" />
                            </div>
                            <h2 className="text-2xl font-black tracking-tight mb-2">最高授权终端 (Admin)</h2>
                            <p className="text-white/40 text-sm mb-8 leading-relaxed">
                                访问控制面需要出示 <code className="text-white/60 text-xs bg-white/5 px-2 py-0.5 rounded">ADMIN_API_KEY</code>。<br />
                                任何非特权探针将被拦截。
                            </p>
                            <div className="w-full space-y-4">
                                <input
                                    type="password"
                                    placeholder="输入服务端配置的 API 密钥"
                                    value={secretKey}
                                    onChange={(e) => setSecretKey(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-3.5 outline-none focus:border-red-500/50 focus:bg-white/10 transition-all font-mono text-center text-lg tracking-[0.2em]"
                                    onKeyDown={(e) => e.key === 'Enter' && fetchAllData()}
                                />
                                <button
                                    onClick={() => fetchAllData()}
                                    disabled={loading}
                                    className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-orange-500 text-white rounded-xl py-3.5 font-bold shadow-lg shadow-red-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                                >
                                    {loading ? <RefreshCcw size={18} className="animate-spin" /> : '发起验证通信'}
                                </button>
                                <button onClick={() => router.push('/')} className="w-full py-3 text-white/30 hover:text-white/70 text-sm font-bold transition-all">
                                    &larr; 返回普通模式
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-[1200px] mx-auto px-4 pb-20">
                    <header className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12 pb-6 border-b border-white/10">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-500/20 text-red-400 rounded-xl"><Code size={24} /></div>
                            <div>
                                <h1 className="text-2xl font-black italic tracking-tighter uppercase whitespace-nowrap">Admin Dashboard</h1>
                                <p className="text-xs font-mono opacity-50 uppercase tracking-[0.2em] mt-1 text-red-300">Classified Access Level</p>
                            </div>
                        </div>
                        <div className="flex border border-white/10 rounded-full p-1 bg-white/5">
                            <button onClick={() => fetchAllData()} className="flex items-center gap-2 px-6 py-2 rounded-full hover:bg-white/10 transition-all font-bold text-sm">
                                <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} /> <span className="hidden sm:inline">强制刷新数据</span>
                            </button>
                            <button onClick={triggerCleanup} disabled={loading} className="flex items-center gap-2 px-6 py-2 rounded-full hover:bg-orange-500/20 hover:text-orange-400 transition-all font-bold text-sm border-x border-white/5">
                                <Activity size={16} className={loading ? 'animate-pulse' : ''} /> <span className="hidden sm:inline">深度大扫除</span>
                            </button>
                            <button onClick={handleLogout} className="flex items-center gap-2 px-6 py-2 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-all font-bold text-sm">
                                <LogOut size={16} /> <span className="hidden sm:inline">退出登录</span>
                            </button>
                        </div>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-gradient-to-b from-indigo-500/10 to-transparent border border-indigo-500/20 p-6 rounded-3xl relative overflow-hidden group">
                            <Users className="absolute -bottom-4 -right-4 text-indigo-500/10 w-32 h-32 transform group-hover:scale-110 transition-transform duration-500" />
                            <h3 className="text-indigo-400 font-bold text-sm tracking-widest uppercase mb-2">活跃注册账户</h3>
                            <div className="text-5xl font-black font-mono tracking-tighter">{stats.users}</div>
                        </div>
                        <div className="bg-gradient-to-b from-blue-500/10 to-transparent border border-blue-500/20 p-6 rounded-3xl relative overflow-hidden group">
                            <PieChart className="absolute -bottom-4 -right-4 text-blue-500/10 w-32 h-32 transform group-hover:scale-110 transition-transform duration-500" />
                            <h3 className="text-blue-400 font-bold text-sm tracking-widest uppercase mb-2">追踪股票条目</h3>
                            <div className="text-5xl font-black font-mono tracking-tighter">{stats.stocks}</div>
                        </div>
                        <div className="bg-gradient-to-b from-cyan-500/10 to-transparent border border-cyan-500/20 p-6 rounded-3xl relative overflow-hidden group">
                            <TrendingUp className="absolute -bottom-4 -right-4 text-cyan-500/10 w-32 h-32 transform group-hover:scale-110 transition-transform duration-500" />
                            <h3 className="text-cyan-400 font-bold text-sm tracking-widest uppercase mb-2">追踪基金条目</h3>
                            <div className="text-5xl font-black font-mono tracking-tighter">{stats.funds}</div>
                        </div>
                    </div>

                    <div className="mb-12">
                        <div className="flex items-center gap-3 mb-6">
                            <Activity size={20} className="text-emerald-500" />
                            <h2 className="text-xl font-bold tracking-tight">D1 数据库实时工况</h2>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white/5 border border-white/10 p-5 rounded-2xl">
                                <p className="text-white/40 text-xs font-mono uppercase mb-1">历史 K 线总数</p>
                                <p className="text-2xl font-black font-mono text-white/90">{(stats.history_points || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 p-5 rounded-2xl">
                                <p className="text-white/40 text-xs font-mono uppercase mb-1">分时高频点位</p>
                                <p className="text-2xl font-black font-mono text-white/90">{(stats.intraday_points || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 p-5 rounded-2xl">
                                <p className="text-white/40 text-xs font-mono uppercase mb-1">实时报价缓存</p>
                                <p className="text-2xl font-black font-mono text-white/90">{(stats.quotes_count || 0).toLocaleString()}</p>
                            </div>
                            <div className="bg-white/5 border border-emerald-500/30 p-5 rounded-2xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-12 h-12 bg-emerald-500/10 flex items-center justify-center rounded-bl-2xl"><TrendingUp size={16} className="text-emerald-500 animate-pulse" /></div>
                                <p className="text-emerald-400/60 text-xs font-mono uppercase mb-1">24H 数据增长</p>
                                <p className="text-2xl font-black font-mono text-emerald-400">+{stats.recent_growth}</p>
                            </div>
                        </div>
                    </div>

                    <div className="mb-12">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <FileText size={20} className="text-blue-500" />
                                <h2 className="text-xl font-bold tracking-tight">System Logs (72H)</h2>
                            </div>
                            <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-[10px] font-mono text-blue-400 uppercase tracking-wider">Backend Pulse Enabled</div>
                        </div>
                        <div className="bg-black/30 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-sm">
                            <div className="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                                {logs.length > 0 ? (
                                    <div className="divide-y divide-white/5 font-mono text-xs">
                                        {logs.map((log, idx) => (
                                            <div key={idx} className="p-4 flex gap-4 hover:bg-white/[0.02] transition-colors">
                                                <span className="text-white/20 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</span>
                                                <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] h-fit ${log.level === 'INFO' ? 'bg-blue-500/20 text-blue-400' : log.level === 'WARN' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'}`}>{log.level}</span>
                                                <span className="text-white/40 whitespace-nowrap border-r border-white/5 pr-4">[{log.module}]</span>
                                                <span className="text-white/80 break-all">{log.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-20 flex flex-col items-center justify-center text-white/20 italic">
                                        <Activity size={32} className="mb-4 opacity-10 animate-pulse" /><p>聆听后端信号中... 暂无关键事件</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="mb-4 flex items-center gap-3">
                        <Activity size={20} className="text-red-500" /><h2 className="text-xl font-bold tracking-tight">实体用户名单稽查区</h2>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                        {users.length > 0 ? (
                            <div className="divide-y divide-white/5">
                                {users.map(u => (
                                    <div key={u} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 hover:bg-white/[0.03] transition-colors group">
                                        <div className="flex items-center gap-4 mb-4 sm:mb-0">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-700 to-gray-500 flex items-center justify-center font-bold text-lg shadow-lg">{u.charAt(0).toUpperCase()}</div>
                                            <div>
                                                <div className="font-mono text-lg font-bold tracking-tight">{u}</div>
                                                <div className="text-xs text-white/30 font-mono uppercase">User ID Hash Reference</div>
                                            </div>
                                        </div>
                                        <button onClick={() => deleteUser(u)} className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-all font-bold text-sm shrink-0 border border-red-500/20 hover:border-red-400">
                                            <Trash2 size={16} /><span>清理账户</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-24 flex flex-col items-center justify-center text-white/30">
                                <FileText size={48} className="mb-4 opacity-20" /><p className="font-mono uppercase tracking-widest text-sm">暂无活跃挂载账户</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </main>
    );
}
