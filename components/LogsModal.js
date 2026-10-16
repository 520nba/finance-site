'use client';

import { useState, useEffect } from 'react';
import { fetchWithTimeout } from '@/lib/client/fetchTimeout';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Clock, AlertTriangle, Info, ShieldAlert, Filter } from 'lucide-react';
import { readAdminKey } from '@/lib/client/adminKey';

export default function LogsModal({ isOpen, onClose }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hours, setHours] = useState(48);
    const [authError, setAuthError] = useState(false);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            // 该接口需要管理员密钥（isAdminAuthorized 只认 x-admin-session/x-admin-key 等），
            // 之前不带任何密钥 → 恒 403 → 弹窗永远显示「无日志」。密钥与后台统一从 adminKey 工具读取。
            const adminKey = typeof window !== 'undefined' ? readAdminKey() : null;

            const res = await fetchWithTimeout(`/api/admin/logs?hours=${hours}`, {
                headers: adminKey ? { 'x-admin-key': adminKey } : {},
            });

            if (res.ok) {
                const data = await res.json();
                // 后端契约是 { success, logs }，之前把整个信封塞进 state，
                // 会让 logs.length===0 判断失效并在渲染期 logs.map 崩掉
                setLogs(Array.isArray(data?.logs) ? data.logs : []);
                setAuthError(false);
            } else {
                setLogs([]);
                setAuthError(res.status === 401 || res.status === 403);
            }
        } catch (e) {
            console.error('Failed to fetch logs:', e);
            setLogs([]);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (isOpen) {
            fetchLogs();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, hours]);

    const handleDownload = () => {
        if (logs.length === 0) return;
        // 后端没有 CSV 分支（`format=csv` 仍返回 JSON），改为前端生成 Blob 下载
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = ['id', 'timestamp(UTC)', 'level', 'module', 'message'].join(',');
        const rows = logs.map(l => [
            l.id, l.timestamp, l.level, l.module, l.message
        ].map(esc).join(','));
        const blob = new Blob(['\uFEFF' + [header, ...rows].join('\r\n')], {
            type: 'text/csv;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `system-logs-${hours}h.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 lg:p-12">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />

            <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="relative w-full max-w-5xl h-[85vh] bg-[#0c0c0e] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-white/2">
                    <div className="flex items-center gap-4">
                        <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400">
                            <ShieldAlert size={22} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black italic tracking-tighter uppercase">系统活动日志</h2>
                            <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">审计与时序追踪记录</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-1.5 border border-white/5">
                            <Clock size={14} className="text-white/20" />
                            <select
                                value={hours}
                                onChange={(e) => setHours(parseInt(e.target.value))}
                                className="bg-transparent border-none outline-none text-xs font-bold text-white/60 cursor-pointer"
                            >
                                <option value={1} className="bg-[#0c0c0e]">最近 1 小时</option>
                                <option value={6} className="bg-[#0c0c0e]">最近 6 小时</option>
                                <option value={24} className="bg-[#0c0c0e]">最近 24 小时</option>
                                <option value={48} className="bg-[#0c0c0e]">最近 48 小时</option>
                            </select>
                        </div>

                        <button
                            onClick={handleDownload}
                            disabled={logs.length === 0}
                            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-xs font-bold transition-all border border-white/5"
                        >
                            <Download size={14} />
                            <span className="hidden sm:inline">导出 CSV 报表</span>
                        </button>

                        <button onClick={onClose} className="p-2.5 hover:bg-white/5 rounded-full transition-all opacity-40 hover:opacity-100">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Log List */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 font-mono text-[13px] leading-relaxed">
                    {loading ? (
                        <div className="flex items-center justify-center h-full opacity-20 animate-pulse">
                            <p className="tracking-widest uppercase font-black">正在扫描数据库日志记录...</p>
                        </div>
                    ) : authError ? (
                        <div className="flex flex-col items-center justify-center h-full opacity-40">
                            <ShieldAlert size={48} className="mb-4 text-yellow-500" />
                            <p className="tracking-widest uppercase font-black">需要管理员密钥</p>
                            <p className="mt-2 text-[11px] opacity-60 normal-case tracking-normal">
                                请先在管理面板完成鉴权（密钥保存在本机浏览器中）
                            </p>
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full opacity-20">
                            <Info size={48} className="mb-4" />
                            <p className="tracking-widest uppercase font-black">当前时间段内无日志信号</p>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {logs.map((log) => (
                                <div key={log.id} className="group flex gap-4 p-2 rounded-lg hover:bg-white/2 transition-colors">
                                    <span className="text-white/20 whitespace-nowrap hidden md:inline">
                                        [{new Date(`${log.timestamp}Z`).toLocaleTimeString('zh-CN', {
                                            timeZone: 'Asia/Shanghai',
                                            hour12: false
                                        })}]
                                    </span>
                                    <span className={`font-black whitespace-nowrap min-w-[60px] ${log.level === 'ERROR' ? 'text-red-500' :
                                        log.level === 'WARN' ? 'text-yellow-500' : 'text-blue-500'
                                        }`}>
                                        {log.level}
                                    </span>
                                    <span className="text-white/40 font-bold whitespace-nowrap min-w-[80px]">
                                        [{log.module}]
                                    </span>
                                    <span className="text-white/80 break-all">{log.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-8 py-4 border-t border-white/5 bg-white/1 text-[10px] text-white/20 uppercase font-black tracking-[0.2em] flex justify-between items-center">
                    <span>日志条目统计: {logs.length}</span>
                    <span className="animate-pulse">实时链路已激活</span>
                </div>
            </motion.div>
        </div>
    );
}
