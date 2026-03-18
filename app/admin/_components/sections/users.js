'use client';

import { motion } from 'framer-motion';
import { Users, Trash2, FileText } from 'lucide-react';

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
