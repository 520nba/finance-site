'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'next/navigation';

import { useAdminAuth } from './_hooks/useAdminAuth';
import { useAdminData } from './_hooks/useAdminData';
import { LoginScreen } from './_components/LoginScreen';
import { AppShell } from './_components/AppShell';
import { Toast, ConfirmModal } from './_components/Overlays';
import {
    OverviewSection,
    HealthSection,
    UsersSection,
    LogsSection,
    QueueSection,
} from './_components/Sections';

function AdminCommandCenter() {
    const [activeSection, setActiveSection] = useState('overview');
    const [toast, setToast] = useState(null);
    const searchParams = useSearchParams();
    const urlKey = searchParams.get('key') || searchParams.get('token');

    const showToast = useCallback((msg, type = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const auth = useAdminAuth();
    const data = useAdminData(auth.secretKey, showToast, auth.handleAuthFailure);

    // 初始化：从 URL 或 sessionStorage 恢复密钥
    useEffect(() => {
        const storedKey = auth.restoreFromStorage();
        const finalKey = urlKey || storedKey;
        if (!finalKey) return;

        auth.setSecretKey(finalKey);
        if (urlKey) window.history.replaceState({}, '', window.location.pathname);

        data.fetchAllData(finalKey).then(() => auth.authenticate(finalKey));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 切换到队列 tab 时自动拉取队列数据
    useEffect(() => {
        if (activeSection === 'queue') data.fetchQueue();
    }, [activeSection, data.fetchQueue]);

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
            >
                <AnimatePresence mode="wait">
                    {activeSection === 'overview' && (
                        <OverviewSection
                            stats={data.stats}
                            onNavigate={setActiveSection}
                            onForceSync={data.triggerForceSync}
                            onCleanup={data.triggerCleanup}
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
                        <QueueSection queueData={data.queueData} />
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
