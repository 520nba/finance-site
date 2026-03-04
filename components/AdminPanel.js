'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trash2, Users, ShieldAlert, RefreshCcw } from 'lucide-react';

export default function AdminPanel({ adminId, onToast }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [secretKey, setSecretKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const fetchUsers = async () => {
        if (!secretKey) return onToast('请输入您的 Server Admin Key');
        setLoading(true);
        try {
            const res = await fetch(`/api/user/list`, {
                headers: { 'x-admin-key': secretKey }
            });
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
                setIsAuthenticated(true);
            } else {
                onToast('鉴权失败: Token 无效');
                setIsAuthenticated(false);
            }
        } catch (e) {
            onToast('服务器连接失败');
            setIsAuthenticated(false);
        }
        setLoading(false);
    };

    const deleteUser = async (targetUserId) => {
        if (!confirm(`确定要彻底删除账户 "${targetUserId}" 及其所有关联数据吗？此操作不可撤销。`)) return;

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
                onToast(`用户 ${targetUserId} 已成功删除`, 'success');
                fetchUsers();
            } else {
                onToast(data.error || '删除失败');
            }
        } catch (e) {
            onToast('删除请求失败');
        }
    };

    if (adminId !== 'admin') return null;

    if (!isAuthenticated) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full glass-effect p-8 border-red-500/10 mb-12 flex flex-col items-center justify-center text-center py-12"
            >
                <ShieldAlert size={48} className="text-red-500/50 mb-4" />
                <h2 className="text-xl font-black tracking-tighter uppercase italic mb-2">安全终端锁定</h2>
                <p className="text-xs text-white/40 mb-6 max-w-sm">
                    系统已启用严格的 ADMIN_API_KEY 环境鉴权。请输入服务端的密钥以解锁控制面板。
                </p>
                <div className="flex gap-2 max-w-sm w-full">
                    <input
                        type="password"
                        placeholder="ADMIN_API_KEY"
                        value={secretKey}
                        onChange={(e) => setSecretKey(e.target.value)}
                        className="flex-1 bg-white/5 border border-red-500/20 rounded-xl px-4 py-2 outline-none focus:border-red-500/60 transition-all font-mono text-sm"
                        onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
                    />
                    <button
                        onClick={fetchUsers}
                        className="bg-red-600/80 hover:bg-red-500 text-white px-6 py-2 rounded-xl font-bold text-sm transition-all flex items-center gap-2"
                        disabled={loading}
                    >
                        {loading ? <RefreshCcw size={14} className="animate-spin" /> : '解锁'}
                    </button>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full glass-effect p-8 border-red-500/10 mb-12"
        >
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/20 rounded-lg text-red-400">
                        <ShieldAlert size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black tracking-tighter uppercase italic">Admin Dashboard</h2>
                        <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">Account & Database Management</p>
                    </div>
                </div>
                <button
                    onClick={fetchUsers}
                    className="p-2 hover:bg-white/5 rounded-full transition-all opacity-40 hover:opacity-100"
                >
                    <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {users.length > 0 ? (
                    users.map(u => (
                        <div key={u} className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-xl hover:border-red-500/20 transition-all group">
                            <div className="flex items-center gap-3">
                                <Users size={16} className="text-white/20" />
                                <span className="font-mono text-sm font-bold opacity-60">{u}</span>
                            </div>
                            <button
                                onClick={() => deleteUser(u)}
                                className="p-2 text-white/10 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                title="Delete User"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full py-12 text-center border border-dashed border-white/5 rounded-xl">
                        <p className="text-white/20 text-xs italic tracking-widest">No other users found in system</p>
                    </div>
                )}
            </div>
        </motion.div>
    );
}
