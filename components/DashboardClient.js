'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, PieChart, RefreshCw, X, Activity, ShieldCheck } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import AssetCard from '@/components/AssetCard';
import WatchlistSidebar from '@/components/WatchlistSidebar';
import LogsModal from '@/components/LogsModal';
import { useAuth, useUI, useAssetsStructure } from '@/providers/AssetProvider';

export default function DashboardClient() {
    const [showLogs, setShowLogs] = useState(false);

    // 1. 认证状态 (低频)
    const {
        userId, isLogged, loginInput, setLoginInput,
        passwordInput, setPasswordInput, isRegistering,
        setIsRegistering, isPending, handleLogin,
        handleRegister, handleLogout
    } = useAuth();

    // 2. UI 交互状态 (低频)
    const {
        activeTab, setActiveTab, selectedCode,
        setSelectedCode, toast, setToast, showToast
    } = useUI();

    // 3. 资产列表结构 (低频)
    const {
        assets, isSyncing, addAsset,
        removeAsset, refreshAssets
    } = useAssetsStructure();

    // ✅ DashboardClient 不调用 useQuotes()，彻底解除对高频行情 Context 的订阅


    const filteredAssets = assets.filter(a => activeTab === 'watchlist' ? a.type === 'stock' : a.type === activeTab);

    const handleSelectAsset = (code) => {
        setSelectedCode(code);
    };

    return (
        <main className="container mx-auto px-4 py-12 max-w-[1400px] min-h-screen">
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold
                            ${toast.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-green-500/90 text-white'}`}
                    >
                        {toast.msg}
                        <button onClick={() => setToast(null)} className="opacity-60 hover:opacity-100 italic"><X size={14} /></button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex flex-col lg:flex-row items-center lg:items-start justify-between mb-8 lg:mb-12 gap-6 lg:gap-8">
                <div className="flex w-full lg:w-auto glass-effect p-1 bg-white/5 border-white/5 flex-shrink-0">
                    <button
                        onClick={() => setActiveTab('stock')}
                        className={`flex-1 lg:px-8 py-2.5 rounded-lg transition-all flex items-center justify-center lg:justify-start gap-2 font-bold text-sm ${activeTab === 'stock' ? 'bg-blue-600 shadow-lg text-white' : 'hover:bg-white/5 opacity-50'}`}
                    >
                        <PieChart size={18} /> 股票
                    </button>
                    <button
                        onClick={() => setActiveTab('fund')}
                        className={`flex-1 lg:px-8 py-2.5 rounded-lg transition-all flex items-center justify-center lg:justify-start gap-2 font-bold text-sm ${activeTab === 'fund' ? 'bg-cyan-600 shadow-lg text-white' : 'hover:bg-white/5 opacity-50'}`}
                    >
                        <TrendingUp size={18} /> 基金
                    </button>
                    <button
                        onClick={() => setActiveTab('watchlist')}
                        className={`flex-1 lg:px-8 py-2.5 rounded-lg transition-all flex items-center justify-center lg:justify-start gap-2 font-bold text-sm ${activeTab === 'watchlist' ? 'bg-indigo-600 shadow-lg text-white' : 'hover:bg-white/5 opacity-50'}`}
                    >
                        <Activity size={18} /> 实时
                    </button>
                </div>

                <div className="flex-1 w-full lg:max-w-xl">
                    <SearchBar onAdd={(code) => addAsset(code, activeTab === 'watchlist' ? 'stock' : activeTab)} />
                </div>

                <div className="flex items-center justify-between w-full lg:w-auto gap-4 flex-shrink-0 pt-1">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="text-[10px] font-mono opacity-40 uppercase tracking-widest">{userId}</span>
                        </div>
                        {isLogged && (
                            <button
                                onClick={handleLogout}
                                className="text-[10px] font-bold opacity-20 hover:opacity-100 hover:text-red-400 uppercase tracking-widest transition-all"
                            >
                                退出
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {isLogged && (
                            <button
                                onClick={() => {
                                    const key = sessionStorage.getItem('tracker_admin_secret');
                                    window.open(`/admin${key ? `?key=${key}` : ''}`, '_blank');
                                }}
                                className="p-2.5 rounded-full border border-white/10 opacity-20 hover:opacity-100 transition-all hover:bg-cyan-500/10 hover:border-cyan-500/30"
                                title="管理员控制中心"
                            >
                                <ShieldCheck size={14} className="text-cyan-400" />
                            </button>
                        )}
                        <button
                            onClick={() => setShowLogs(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 opacity-40 hover:opacity-100 transition-all font-bold"
                        >
                            <Activity size={14} />
                            <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">日志</span>
                        </button>
                        <button
                            onClick={refreshAssets}
                            disabled={isSyncing}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 opacity-40 hover:opacity-100 transition-all disabled:cursor-not-allowed ${isSyncing ? 'animate-pulse' : ''}`}
                        >
                            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                            <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">同步</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
                {isLogged && assets.length > 0 && (
                    <WatchlistSidebar
                        key={userId}
                        assets={filteredAssets}
                        mode={activeTab === 'watchlist' ? 'realtime' : 'volatility'}
                        selectedCode={selectedCode}
                        onSelect={handleSelectAsset}
                    />
                )}

                <div className="flex-1 min-w-0 min-h-[400px] w-full">
                    <AnimatePresence mode="popLayout">
                        {!isLogged ? (
                            <motion.div
                                key="login"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="max-w-md mx-auto py-24 text-center"
                            >
                                <h2 className="text-2xl font-black italic mb-2 tracking-tighter">账户登录</h2>
                                <p className="text-white/30 text-sm mb-8">
                                    {isRegistering ? '创建一个新账户以开启同步' : '输入您的凭据以访问自选列表'}
                                </p>
                                <div className="space-y-4 max-w-sm mx-auto">
                                    <input
                                        type="text"
                                        placeholder="用户名"
                                        autoComplete="username"
                                        value={loginInput}
                                        onChange={(e) => setLoginInput(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm font-mono text-white"
                                    />
                                    <input
                                        type="password"
                                        placeholder="密码 (不少于8位)"
                                        autoComplete="current-password"
                                        value={passwordInput}
                                        onChange={(e) => setPasswordInput(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm font-mono text-white"
                                        onKeyDown={(e) => e.key === 'Enter' && !isPending && (isRegistering ? handleRegister() : handleLogin())}
                                    />
                                    <div className="flex flex-col gap-3 pt-2">
                                        <button
                                            onClick={isRegistering ? handleRegister : handleLogin}
                                            disabled={isPending}
                                            className={`w-full ${isPending ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'} py-3 rounded-xl font-black uppercase tracking-widest text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2`}
                                        >
                                            {isPending && <RefreshCw size={14} className="animate-spin" />}
                                            {isRegistering ? (isPending ? '注册中...' : '立即注册') : (isPending ? '验证中...' : '安全登入')}
                                        </button>
                                        <button
                                            onClick={() => setIsRegistering(!isRegistering)}
                                            disabled={isPending}
                                            className="text-xs font-bold text-white/20 hover:text-white/60 transition-colors uppercase tracking-widest disabled:opacity-50"
                                        >
                                            {isRegistering ? '已有账号？返回登录' : '没有账号？创建新身份'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6" key="cards">
                                {filteredAssets.length > 0 ? (
                                    filteredAssets.map(asset => (
                                        <AssetCard
                                            key={asset.code}
                                            asset={asset}
                                            onRemove={removeAsset}
                                            mode={activeTab === 'watchlist' ? 'realtime' : 'volatility'}
                                        />
                                    ))
                                ) : (
                                    <motion.div
                                        key="empty"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="col-span-full text-center py-24 glass-effect border-dashed border-white/5"
                                    >
                                        <p className="text-white/20 italic tracking-widest">
                                            暂无相关数据，输入代码开启追踪
                                        </p>
                                    </motion.div>
                                )}
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <LogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} />

            <footer className="mt-24 pt-12 border-t border-white/5 text-center text-white/20 text-sm">
                <p>&copy; 2026 Antigravity 金融实验室。数据源由 腾讯 &amp; 天天基金 提供。</p>
            </footer>
        </main>
    );
}
