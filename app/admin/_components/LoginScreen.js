'use client';

import { motion } from 'framer-motion';
import { ShieldAlert, RefreshCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function LoginScreen({ secretKey, setSecretKey, loading, onSubmit }) {
    const router = useRouter();

    return (
        <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#050510]">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-lg p-12 bg-black/40 border border-white/5 rounded-[3rem]
                    backdrop-blur-3xl shadow-2xl relative overflow-hidden"
            >
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600" />
                <div className="flex flex-col items-center text-center">
                    <div className="w-24 h-24 bg-blue-500/10 rounded-3xl flex items-center justify-center mb-8 rotate-12">
                        <ShieldAlert size={42} className="text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)]" />
                    </div>
                    <h2 className="text-3xl font-black tracking-tighter italic uppercase mb-3 text-white">首席调度中心</h2>
                    <p className="text-white/30 text-sm mb-10 leading-relaxed font-medium uppercase tracking-[0.15em]">
                        基础设施与 API 健康巡检控制台<br />
                        <span className="opacity-50 font-mono text-[10px]">[受保护权限 - 仅限核心管理员]</span>
                    </p>
                    <div className="w-full space-y-6">
                        <div className="space-y-2 text-left">
                            <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20 ml-2">
                                身份鉴权密钥
                            </label>
                            <input
                                type="password"
                                placeholder="••••••••••••••••"
                                value={secretKey}
                                onChange={(e) => setSecretKey(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && onSubmit(secretKey)}
                                className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-6 py-5
                                    outline-none focus:border-cyan-500/50 focus:bg-white/5 transition-all
                                    font-mono text-center text-xl tracking-[0.3em] text-white"
                            />
                        </div>
                        <button
                            onClick={() => onSubmit(secretKey)}
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-cyan-500 text-white rounded-2xl py-5
                                font-black uppercase tracking-widest shadow-xl shadow-blue-500/10
                                transition-all disabled:opacity-50 disabled:cursor-not-allowed
                                flex justify-center items-center gap-3"
                        >
                            {loading ? <RefreshCcw size={20} className="animate-spin" /> : '建立通信连接'}
                        </button>
                        <button
                            onClick={() => router.push('/')}
                            className="w-full py-4 text-white/20 hover:text-white/60
                                text-[10px] font-black uppercase tracking-[0.4em] transition-all"
                        >
                            &larr; 返回系统主界面
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
