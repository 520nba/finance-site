'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trash2, Users, ShieldAlert, RefreshCcw } from 'lucide-react';

export default function AdminPanel({ adminId, onToast }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/user/list?adminId=${adminId}`);
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            }
        } catch (e) {
            onToast('获取用户列表失败');
        }
        setLoading(false);
    };

    const deleteUser = async (targetUserId) => {
        if (!confirm(`确定要彻底删除账户 "${targetUserId}" 及其所有关联数据吗？此操作不可撤销。`)) return;

        try {
            const res = await fetch('/api/user/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminId, targetUserId }),
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

    useEffect(() => {
        if (adminId === 'admin') {
            fetchUsers();
        }
    }, [adminId]);

    if (adminId !== 'admin') return null;

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
