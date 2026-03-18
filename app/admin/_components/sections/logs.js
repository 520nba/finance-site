'use client';

import { motion } from 'framer-motion';
import { FileText, Activity } from 'lucide-react';

export function LogsSection({ logs }) {
    return (
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} key="logs">
            <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400"><FileText size={24} /></div>
                <div>
                    <h2 className="text-2xl font-black italic uppercase tracking-tighter text-white">系统脉搏记录</h2>
                    <p className="text-xs text-white/20 font-bold uppercase tracking-[0.15em]">时序活动追踪 (最近 72 小时窗口)</p>
                </div>
            </div>
            <div className="bg-white/[0.01] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl lg:p-4">
                <div className="max-h-[600px] overflow-y-auto custom-scrollbar px-6 py-4">
                    {logs.length > 0 ? (
                        <div className="space-y-1">
                            {logs.map(log => (
                                <div
                                    key={log.id || `${log.timestamp}-${log.module}`}
                                    className="group flex flex-col md:flex-row gap-4 py-2 px-5 rounded-xl hover:bg-white/[0.02] border border-transparent hover:border-white/5 transition-all"
                                >
                                    <div className="flex items-center gap-4 min-w-[200px]">
                                        <div className={`w-1 h-1 rounded-full ${log.level === 'INFO' ? 'bg-blue-500' : log.level === 'WARN' ? 'bg-orange-500' : 'bg-red-500'}`} />
                                        <span className="text-xs font-mono font-bold text-white/30">
                                            {new Date(log.timestamp + 'Z').toLocaleString('zh-CN', {
                                                timeZone: 'Asia/Shanghai',
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                                hour12: false,
                                            })}
                                        </span>
                                    </div>
                                    <div className="flex-1 flex gap-4">
                                        <span className="text-[11px] font-black px-2 py-0.5 bg-white/5 rounded-md text-white/40 uppercase tracking-widest h-fit">[{log.module}]</span>
                                        <p className="text-xs font-medium text-white/60 leading-tight group-hover:text-white/90 transition-colors uppercase tracking-tight">{log.message}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-40 flex flex-col items-center justify-center text-white/10 italic text-center">
                            <Activity size={48} className="mb-4 opacity-5 animate-pulse mx-auto" />
                            <p className="font-black uppercase tracking-[0.4em] text-xs">正在等待背板信号...</p>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
