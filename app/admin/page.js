'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { AnimatePresence } from 'framer-motion';

import { useAdminAuth } from './_hooks/useAdminAuth';
import { useAdminData } from './_hooks/useAdminData';
import { LoginScreen } from './_components/LoginScreen';
import { AppShell } from './_components/AppShell';
import { Toast, ConfirmModal } from './_components/Overlays';
import { OverviewSection } from './_components/sections/overview';
import { HealthSection } from './_components/sections/health';
import { UsersSection } from './_components/sections/users';
import { LogsSection } from './_components/sections/logs';
import { QueueSection } from './_components/sections/queue';
import { AssetStatusSection } from './_components/sections/assets';

function AdminCommandCenter() {
    const [activeSection, setActiveSection] = useState('overview');
    const [toast, setToast] = useState(null);

    // 定时器放 ref：曾经把 handle 存在 state 里，导致每次 showToast 都产生新函数身份
    // （showToast → fetchAssetStatus → tab effect 依赖），进入「资产监控」后会无限循环打接口。
    const toastTimerRef = useRef(null);

    const showToast = useCallback((msg, type = 'error', duration = 3000) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, type });
        toastTimerRef.current = duration > 0 ? setTimeout(() => setToast(null), duration) : null;
    }, []);

    useEffect(() => () => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    }, []);

    const auth = useAdminAuth();
    const data = useAdminData(auth.secretKey, showToast, auth.handleAuthFailure);

    // 初始化：只从本地存储恢复密钥（不再接受 URL ?key=，避免 PSK 进入日志/历史/Referer）
    useEffect(() => {
        const storedKey = auth.restoreFromStorage();
        if (!storedKey) return;

        auth.setSecretKey(storedKey);
        data.fetchAllData(storedKey).then(() => auth.authenticate(storedKey));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 切换到队列/资产 tab 时拉取数据。
    // 只依赖 activeSection：数据层回调身份会随 showToast/secretKey 变化，
    // 放进依赖会导致「进入 tab → 拉数据 → 弹 toast → 回调换身份 → effect 重跑」的自激循环。
    const fetchersRef = useRef({ fetchQueue: data.fetchQueue, fetchAssetStatus: data.fetchAssetStatus });
    fetchersRef.current = { fetchQueue: data.fetchQueue, fetchAssetStatus: data.fetchAssetStatus };

    useEffect(() => {
        if (activeSection === 'queue') fetchersRef.current.fetchQueue();
        if (activeSection === 'assets') fetchersRef.current.fetchAssetStatus();
    }, [activeSection]);

    if (!auth.isAuthenticated) {
        return (
            <LoginScreen
                secretKey={auth.secretKey}
                setSecretKey={auth.setSecretKey}
                loading={data.loading}
                onSubmit={(key) => data.fetchAllData(key).then(() => auth.authenticate(key))}
            />
        );
    }

    return (
        <>
            <Toast toast={toast} />
            <ConfirmModal confirmAction={data.confirmAction} onCancel={() => data.setConfirmAction(null)} />

            <AppShell
                activeSection={activeSection}
                onNavigate={setActiveSection}
                onLogout={auth.handleLogout}
                loading={data.loading}
                onRefresh={() => data.fetchAllData(auth.secretKey, true)}
                onForceSync={data.triggerForceSync}
                onCleanup={data.triggerCleanup}
                onFullSync={data.triggerFullSync}
            >
                <AnimatePresence mode="wait">
                    {activeSection === 'overview' && (
                        <OverviewSection
                            stats={data.stats}
                            onNavigate={setActiveSection}
                            onForceSync={data.triggerForceSync}
                            onCleanup={data.triggerCleanup}
                            onFullSync={data.triggerFullSync}
                            loading={data.loading}
                        />
                    )}
                    {activeSection === 'health' && (
                        <HealthSection apiHealth={data.stats.api_health} />
                    )}
                    {activeSection === 'users' && (
                        <UsersSection users={data.users} onDeleteUser={data.deleteUser} />
                    )}
                    {activeSection === 'logs' && (
                        <LogsSection logs={data.logs} />
                    )}
                    {activeSection === 'queue' && (
                        <QueueSection
                            queueData={data.queueData}
                            onRefresh={data.fetchQueue}
                            loading={data.queueLoading}
                        />
                    )}
                    {activeSection === 'assets' && (
                        <AssetStatusSection
                            assets={data.assetStatus}
                            onRefresh={data.fetchAssetStatus}
                            loading={data.assetStatusLoading}
                        />
                    )}
                </AnimatePresence>
            </AppShell>
        </>
    );
}

export default function AdminPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#050510] flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/10 border-t-cyan-500 rounded-full animate-spin" />
            </div>
        }>
            <AdminCommandCenter />
        </Suspense>
    );
}
