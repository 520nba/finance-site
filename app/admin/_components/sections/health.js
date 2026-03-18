'use client';

import { motion } from 'framer-motion';
import { Wifi, Clock } from 'lucide-react';

const TYPE_COLOR = {
    Hist: 'from-purple-500/20 text-purple-400',
    Quote: 'from-emerald-500/20 text-emerald-400',
    Intra: 'from-blue-500/20 text-blue-400',
    Name: 'from-orange-500/20 text-orange-400',
};

export function HealthSection({ apiHealth }) {
    return (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="health">
            <div className="flex items-center justify-between mb-8 px-2">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-500/10 rounded-2xl text-cyan-400"><Wifi size={24} /></div>
                    <div>
                        <h2 className="text-2xl font-black italic uppercase tracking-tighter">全栈巡检实时监测中心</h2>
                        <p className="text-xs text-white/20 font-bold uppercase tracking-[0.2em]">
                            外部金融协议心跳数据监测 ({apiHealth?.length || 0} 已连接节点)
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-cyan-500/60">
                    <Clock size={12} /> 实时遥测中
                </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/5 bg-white/[0.01]">
                            {['协议与通道', '状态', '成功率', '延迟'].map((h, i) => (
                                <th key={h} className={`px-10 py-6 text-xs font-black uppercase tracking-[0.3em] text-white/30 ${i > 1 ? 'text-right' : i === 1 ? 'text-center' : ''}`}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.02]">
                        {apiHealth?.length > 0 ? apiHealth.map((api) => {
                            const [type, ...rest] = api.api_name.split(':');
                            const mainName = rest.length ? rest.join(':').trim() : api.api_name;
                            const typeColor = TYPE_COLOR[type] || 'from-gray-500/20 text-gray-400';
                            return (
                                <tr key={api.api_name} className="group hover:bg-white/[0.02] transition-colors">
                                    <td className="px-10 py-6">
                                        <div className="flex items-center gap-4">
                                            <div className={`px-2 py-0.5 rounded bg-gradient-to-r ${typeColor} text-[10px] font-black uppercase tracking-widest border border-white/5`}>{type}</div>
                                            <div className="flex flex-col">
                                                <span className="font-bold text-base text-white/80 group-hover:text-cyan-400 transition-colors tracking-tight truncate max-w-[240px]">{mainName}</span>
                                                <span className="text-[11px] text-white/20 mt-0.5 uppercase font-mono tracking-widest italic">{api.error_msg || 'Heartbeat Optimal'}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-10 py-6">
                                        <div className="flex justify-center">
                                            {api.status === 'healthy' ? (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[11px] font-black uppercase tracking-tighter border border-emerald-500/20">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />健康
                                                </div>
                                            ) : api.status === 'critical' ? (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-red-600/10 text-red-500 rounded-full text-[11px] font-black uppercase tracking-tighter border border-red-600/20">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-bounce" />故障
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-full text-[11px] font-black uppercase tracking-tighter border border-yellow-500/20">延迟</div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-10 py-6 text-right">
                                        <span className="font-mono font-black text-xl text-white/50 group-hover:text-white transition-colors">{api.success_rate}</span>
                                    </td>
                                    <td className="px-10 py-6 text-right font-mono">
                                        <span className={`font-black text-base ${(api.avg_latency ?? 0) > 3000 ? 'text-red-400' : (api.avg_latency ?? 0) > 1500 ? 'text-yellow-400' : 'text-white/40 group-hover:text-white/80'}`}>
                                            {api.avg_latency ?? '--'}
                                        </span>
                                        <span className="text-[11px] opacity-20 ml-1 font-black">ms</span>
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr><td colSpan="4" className="px-10 py-32 text-center text-white/10 italic font-medium uppercase tracking-[0.3em] text-sm">正在等待巡检心跳信号</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
}
