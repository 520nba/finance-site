'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, PieChart, RefreshCw, X, Activity, ShieldCheck, Plus } from 'lucide-react';
import AddAssetModal from '@/components/AddAssetModal';
import AssetCard from '@/components/AssetCard';
import WatchlistSidebar from '@/components/WatchlistSidebar';
import LogsModal from '@/components/LogsModal';
import { useAuth, useUI, useAssetsStructure } from '@/providers/AssetProvider';
import { readAdminKey, writeAdminKey } from '@/lib/client/adminKey';

export default function DashboardClient() {
    const [showLogs, setShowLogs] = useState(false);
    const [showAdd, setShowAdd] = useState(false);

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

    // 登录/注册共用一个提交入口：useAuth 的 handleLogin/handleRegister 会返回
    // { ok, error }，此前 onClick 直接把它丢掉 → 密码错误/用户名占用/网络异常时界面毫无反馈。
    const submitCredentials = useCallback(async () => {
        const res = isRegistering ? await handleRegister() : await handleLogin();
        if (res && res.ok === false) {
            showToast(res.error || (isRegistering ? '注册失败，请重试' : '登录失败，请检查用户名与密码'));
        }
    }, [isRegistering, handleRegister, handleLogin, showToast]);


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

            {/* 未登录时整套操作栏不渲染：此前访客也能看到 tabs/搜索/添加/批量/日志/同步，
                点了要么弹错、要么静默 401 */}
            <div className={`${isLogged ? 'flex' : 'hidden'} flex-col lg:flex-row items-center lg:items-start justify-between mb-8 lg:mb-12 gap-6 lg:gap-8`}>
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

                {/* 添加表单已收进弹窗，这里只留弹性占位，顶栏不再被输入框占满一整行 */}
                <div className="hidden lg:block flex-1" />

                <div className="flex items-center justify-between w-full lg:w-auto gap-4 flex-shrink-0 pt-1">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="text-[10px] font-mono opacity-70 uppercase tracking-widest">{userId}</span>
                        </div>
                        {isLogged && (
                            <button
                                onClick={handleLogout}
                                className="text-[10px] font-bold opacity-50 hover:opacity-100 hover:text-red-400 uppercase tracking-widest transition-all flex-shrink-0 whitespace-nowrap"
                            >
                                退出
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {isLogged && (
                            <button
                                onClick={() => setShowAdd(true)}
                                title="添加资产"
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg shadow-blue-600/20 flex-shrink-0 whitespace-nowrap"
                            >
                                <Plus size={16} />
                                <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">添加资产</span>
                            </button>
                        )}
                        {isLogged && (
                            <button
                                onClick={() => {
                                    // 不再把管理员密钥拼进 URL（会进浏览器历史与 Cloudflare 日志）；
                                    // 新标签页通过 localStorage 桥接读取密钥
                                    const key = readAdminKey();
                                    if (key) writeAdminKey(key);
                                    window.open('/admin', '_blank');
                                }}
                                className="p-2.5 rounded-full border border-white/10 opacity-40 hover:opacity-100 transition-all hover:bg-cyan-500/10 hover:border-cyan-500/30"
                                title="管理员控制中心"
                            >
                                <ShieldCheck size={14} className="text-cyan-400" />
                            </button>
                        )}
                        <button
                            onClick={() => setShowLogs(true)}
                            className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 opacity-70 hover:opacity-100 transition-all font-bold"
                        >
                            <Activity size={14} />
                            <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">日志</span>
                        </button>
                        <button
                            onClick={() => refreshAssets()}
                            disabled={isSyncing}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 opacity-70 hover:opacity-100 transition-all disabled:cursor-not-allowed ${isSyncing ? 'animate-pulse' : ''}`}
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
                                <p className="text-white/50 text-sm mb-8">
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
                                        onKeyDown={(e) => e.key === 'Enter' && !isPending && submitCredentials()}
                                    />
                                    <div className="flex flex-col gap-3 pt-2">
                                        <button
                                            onClick={submitCredentials}
                                            disabled={isPending}
                                            className={`w-full ${isPending ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'} py-3 rounded-xl font-black uppercase tracking-widest text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2`}
                                        >
                                            {isPending && <RefreshCw size={14} className="animate-spin" />}
                                            {isRegistering ? (isPending ? '注册中...' : '立即注册') : (isPending ? '验证中...' : '安全登入')}
                                        </button>
                                        <button
                                            onClick={() => setIsRegistering(!isRegistering)}
                                            disabled={isPending}
                                            className="text-xs font-bold text-white/45 hover:text-white/80 transition-colors uppercase tracking-widest disabled:opacity-50"
                                        >
                                            {isRegistering ? '已有账号？返回登录' : '没有账号？创建新身份'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6" key="cards">
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
                                        <p className="text-white/45 italic tracking-widest">
                                            暂无相关数据，添加代码开启追踪
                                        </p>
                                        <button
                                            onClick={() => setShowAdd(true)}
                                            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 transition-all font-bold"
                                        >
                                            <Plus size={16} /> 添加资产
                                        </button>
                                    </motion.div>
                                )}
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <AddAssetModal
                isOpen={showAdd}
                onClose={() => setShowAdd(false)}
                onAdd={(code, opts) => addAsset(code, activeTab === 'watchlist' ? 'stock' : activeTab, opts)}
                tabLabel={activeTab === 'fund' ? '基金' : '股票'}
            />

            <LogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} />

            <footer className="mt-24 pt-12 border-t border-white/5 text-center text-white/40 text-sm">
                <p>&copy; 2026 Antigravity 金融实验室。数据源由 腾讯 &amp; 天天基金 提供。</p>
            </footer>
        </main>
    );
}
