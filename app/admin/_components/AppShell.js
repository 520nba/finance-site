'use client';

import { useState, useEffect } from 'react';
import {
    LayoutGrid, Wifi, RefreshCcw, Users, FileText, Code,
    LogOut, TrendingUp, PieChart, Zap,
} from 'lucide-react';

const NAV_ITEMS = [
    { id: 'overview', icon: <LayoutGrid size={20} />, label: '概览面板' },
    { id: 'health', icon: <Wifi size={20} />, label: '接口哨兵' },
    { id: 'queue', icon: <RefreshCcw size={20} />, label: '同步队列' },
    { id: 'users', icon: <Users size={20} />, label: '用户审计' },
    { id: 'logs', icon: <FileText size={20} />, label: '系统日志' },
    { id: 'assets', icon: <TrendingUp size={20} />, label: '资产监控' },
];

export function AppShell({ activeSection, onNavigate, onLogout, loading, onRefresh, onForceSync, onCleanup, children }) {
    const [currentTime, setCurrentTime] = useState(null);

    useEffect(() => {
        setCurrentTime(new Date());
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <main className="min-h-screen bg-[#050510] relative text-white selection:bg-cyan-500/30 font-sans overflow-x-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 blur-[120px] rounded-full" />
            </div>

            <div className="flex h-screen overflow-hidden relative z-10">
                {/* Sidebar */}
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
                        {NAV_ITEMS.map(item => (
                            <button
                                key={item.id}
                                onClick={() => onNavigate(item.id)}
                                className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all group
                                    ${activeSection === item.id
                                        ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
                                        : 'text-white/40 hover:bg-white/5 hover:text-white/80'}`}
                            >
                                <div className={activeSection === item.id ? 'text-white' : 'text-white/20 group-hover:text-white/60'}>
                                    {item.icon}
                                </div>
                                <span className="hidden md:block font-bold text-sm tracking-tight">{item.label}</span>
                            </button>
                        ))}
                    </nav>
                    <div className="p-4 border-t border-white/5 mb-6">
                        <button
                            onClick={onLogout}
                            className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-red-500/50 hover:bg-red-500/10 hover:text-red-500 transition-all font-bold"
                        >
                            <LogOut size={20} />
                            <span className="hidden md:block text-sm">注销通信</span>
                        </button>
                    </div>
                </aside>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-[#050510] custom-scrollbar">
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
                                <button onClick={onRefresh} title="刷新并校准计数器" className={`p-1.5 hover:text-cyan-400 transition-colors ${loading ? 'animate-spin opacity-50' : ''}`}>
                                    <RefreshCcw size={16} />
                                </button>
                                <div className="w-px h-3 bg-white/10 mx-1" />
                                <button onClick={() => onForceSync('stock')} disabled={loading} title="重刷所有股票历史数据" className="p-1.5 hover:text-emerald-400 disabled:opacity-30 transition-colors flex items-center gap-1.5 group/btn">
                                    <TrendingUp size={16} className="group-hover/btn:scale-110 transition-transform" />
                                    <span className="text-[9px] font-black uppercase tracking-tighter hidden xl:inline">股票重刷</span>
                                </button>
                                <div className="w-px h-3 bg-white/10 mx-1" />
                                <button onClick={() => onForceSync('fund')} disabled={loading} title="重刷所有基金历史数据" className="p-1.5 hover:text-blue-400 disabled:opacity-30 transition-colors flex items-center gap-1.5 group/btn">
                                    <PieChart size={16} className="group-hover/btn:scale-110 transition-transform" />
                                    <span className="text-[9px] font-black uppercase tracking-tighter hidden xl:inline">基金重刷</span>
                                </button>
                                <div className="w-px h-3 bg-white/10 mx-1" />
                                <button onClick={onCleanup} title="全量环境洗消" className="p-1.5 hover:text-orange-400 transition-colors">
                                    <Zap size={16} />
                                </button>
                            </div>
                            <div className="text-[10px] font-mono font-bold text-white/20 bg-white/5 px-4 py-2 rounded-xl border border-white/5 min-w-[160px] text-center">
                                {currentTime
                                    ? currentTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
                                    : '--:--:--'}
                            </div>
                        </div>
                    </header>

                    <div className="p-10 max-w-[1200px] mx-auto">
                        {children}
                    </div>
                </div>
            </div>
        </main>
    );
}
