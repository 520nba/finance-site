'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Users, ShieldAlert, Activity, PieChart, TrendingUp, RefreshCcw, LogOut, Code, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState({ users: 0, stocks: 0, funds: 0 });
    const [loading, setLoading] = useState(false);
    const [secretKey, setSecretKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [toast, setToast] = useState(null);
    const router = useRouter();

    // 加载缓存密钥（如果有并且依然有效）
    useEffect(() => {
        const cachedKey = localStorage.getItem('tracker_admin_secret');
        if (cachedKey) {
            setSecretKey(cachedKey);
            // 自动不使用缓存自动发送请求，以免弹框
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
            const [usersRes, statsRes] = await Promise.all([
                fetch('/api/user/list', { headers: { 'x-admin-key': keyToUse } }),
                fetch('/api/admin/stats', { headers: { 'x-admin-key': keyToUse } })
            ]);

            if (usersRes.ok && statsRes.ok) {
                const usersData = await usersRes.json();
                const statsData = await statsRes.json();

                setUsers(usersData);
                if (statsData.users !== undefined) setStats(statsData);

                setIsAuthenticated(true);
                localStorage.setItem('tracker_admin_secret', keyToUse);
            } else {
                showToast('鉴权失败: 密钥无效或无权限');
                setIsAuthenticated(false);
                localStorage.removeItem('tracker_admin_secret');
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
                fetchAllData(); // 必须重新刷新拉去最新人数与用户集合
            } else {
                showToast(data.error || '删除失败');
            }
        } catch (e) {
            showToast('删除请求发出异常');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('tracker_admin_secret');
        setIsAuthenticated(false);
        setSecretKey('');
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

            {/* 当还没鉴权成功时渲染锁屏大门 */}
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
                                <button
                                    onClick={() => router.push('/')}
                                    className="w-full py-3 text-white/30 hover:text-white/70 text-sm font-bold transition-all"
                                >
                                    &larr; 返回普通模式
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            ) : (
                /* 真实的主控制台页面 */
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="max-w-[1200px] mx-auto px-4 pb-20"
                >
                    <header className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12 pb-6 border-b border-white/10">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-500/20 text-red-400 rounded-xl">
                                <Code size={24} />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black italic tracking-tighter uppercase whitespace-nowrap">Admin Dashboard</h1>
                                <p className="text-xs font-mono opacity-50 uppercase tracking-[0.2em] mt-1 text-red-300">Classified Access Level</p>
                            </div>
                        </div>

                        <div className="flex border border-white/10 rounded-full p-1 bg-white/5">
                            <button
                                onClick={() => fetchAllData()}
                                className="flex items-center gap-2 px-6 py-2 rounded-full hover:bg-white/10 transition-all font-bold text-sm"
                            >
                                <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} /> <span className="hidden sm:inline">强制刷新全量结构</span>
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-2 px-6 py-2 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-all font-bold text-sm"
                            >
                                <LogOut size={16} /> <span className="hidden sm:inline">销毁凭证退出</span>
                            </button>
                        </div>
                    </header>

                    {/* KV 数据大盘 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                        <div className="bg-gradient-to-b from-indigo-500/10 to-transparent border border-indigo-500/20 p-6 rounded-3xl relative overflow-hidden group">
                            <Users className="absolute -bottom-4 -right-4 text-indigo-500/10 w-32 h-32 transform group-hover:scale-110 transition-transform duration-500" />
                            <h3 className="text-indigo-400 font-bold text-sm tracking-widest uppercase mb-2">活跃注册账户 (User KV)</h3>
                            <div className="text-5xl font-black font-mono tracking-tighter">{stats.users}</div>
                        </div>
                        <div className="bg-gradient-to-b from-blue-500/10 to-transparent border border-blue-500/20 p-6 rounded-3xl relative overflow-hidden group">
                            <PieChart className="absolute -bottom-4 -right-4 text-blue-500/10 w-32 h-32 transform group-hover:scale-110 transition-transform duration-500" />
                            <h3 className="text-blue-400 font-bold text-sm tracking-widest uppercase mb-2">追踪股票条目 (Stock KV)</h3>
                            <div className="text-5xl font-black font-mono tracking-tighter">{stats.stocks}</div>
                        </div>
                        <div className="bg-gradient-to-b from-cyan-500/10 to-transparent border border-cyan-500/20 p-6 rounded-3xl relative overflow-hidden group">
                            <TrendingUp className="absolute -bottom-4 -right-4 text-cyan-500/10 w-32 h-32 transform group-hover:scale-110 transition-transform duration-500" />
                            <h3 className="text-cyan-400 font-bold text-sm tracking-widest uppercase mb-2">追踪基金条目 (Fund KV)</h3>
                            <div className="text-5xl font-black font-mono tracking-tighter">{stats.funds}</div>
                        </div>
                    </div>

                    <div className="mb-4 flex items-center gap-3">
                        <Activity size={20} className="text-red-500" />
                        <h2 className="text-xl font-bold tracking-tight">实体用户名单稽查区</h2>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                        {users.length > 0 ? (
                            <div className="divide-y divide-white/5">
                                {users.map(u => (
                                    <div key={u} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 hover:bg-white/[0.03] transition-colors group">
                                        <div className="flex items-center gap-4 mb-4 sm:mb-0">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-700 to-gray-500 flex items-center justify-center font-bold text-lg shadow-lg">
                                                {u.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-mono text-lg font-bold tracking-tight">{u}</div>
                                                <div className="text-xs text-white/30 font-mono uppercase">User ID Hash Reference</div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => deleteUser(u)}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-all font-bold text-sm shrink-0 border border-red-500/20 hover:border-red-400"
                                        >
                                            <Trash2 size={16} />
                                            <span>清理账户</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-24 flex flex-col items-center justify-center text-white/30">
                                <FileText size={48} className="mb-4 opacity-20" />
                                <p className="font-mono uppercase tracking-widest text-sm">暂无活跃挂载账户</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </main>
    );
}
