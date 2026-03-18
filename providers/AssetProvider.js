'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AuthContext, AssetsStructureContext, QuotesContext, UIContext } from './contexts';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useAssetSync } from '@/hooks/useAssetSync';
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuotes';
import { useAssetActions } from '@/hooks/useAssetActions';

// ── 1. 认证层：管理登录/注册/会话 ────────────────────────────────────
function AuthProvider({ children }) {
    const auth = useAuthSession();

    const value = useMemo(() => ({
        ...auth,
        handleLogin: auth.handleLogin,
        handleRegister: auth.handleRegister,
    }), [
        auth.userId, auth.isLogged, auth.isPending, auth.loginInput,
        auth.passwordInput, auth.isRegistering, auth.handleLogin,
        auth.handleRegister, auth.handleLogout
    ]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── 2. UI 状态层：管理 Tab 切换、选中项与全局通知 ──────────────────────────
function UIProvider({ children }) {
    const [activeTab, setActiveTab] = useState('stock');
    const [selectedCode, setSelectedCode] = useState(null);
    const [toast, setToast] = useState(null);

    const showToast = useCallback((msg, type = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);

    const value = useMemo(() => ({
        activeTab, setActiveTab,
        selectedCode, setSelectedCode,
        toast, setToast, showToast
    }), [activeTab, selectedCode, toast, showToast]);

    return (
        <UIContext.Provider value={value}>
            {children}
        </UIContext.Provider>
    );
}

// ── 3. 资产结构层：管理资产列表及其同步 ──────────────────────────────────
function AssetsStructureProvider({ children }) {
    const { userId, isLogged } = useAuth();
    const { activeTab, selectedCode, setSelectedCode, showToast } = useUI();

    // 稳定性优化：使用 Ref 隔离 UI 状态变更，防止 addAsset/removeAsset 引用抖动
    const activeTabRef = useRef(activeTab);
    const selectedCodeRef = useRef(selectedCode);

    // 同步 Ref (Effect 虽然会运行，但不会像直接传值那样导致 useCallback 依赖失效)
    useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
    useEffect(() => { selectedCodeRef.current = selectedCode; }, [selectedCode]);

    const {
        assets, setAssets, isSyncing, setIsSyncing, assetsRef, refreshAssets, syncAssetsToServer
    } = useAssetSync({ userId, isLogged });

    const { addAsset, removeAsset } = useAssetActions({
        activeTabRef,
        setAssets,
        setIsSyncing,
        showToast,
        selectedCodeRef,
        setSelectedCode,
        syncAssetsToServer,
        assetsRef
    });

    const value = useMemo(() => ({
        assets, setAssets, isSyncing, setIsSyncing, assetsRef,
        addAsset, removeAsset,
        refreshAssets: (list) => refreshAssets(list ?? assets.map(a => ({ code: a.code, type: a.type }))),
        syncAssetsToServer
    }), [assets, isSyncing, addAsset, removeAsset, refreshAssets, syncAssetsToServer]); // ✅ 补充 refreshAssets 依赖，消除隐性闭包风险

    return <AssetsStructureContext.Provider value={value}>{children}</AssetsStructureContext.Provider>;
}

// ── 4. 实时行情层 (高频更新区)：管理报价与分时数据 ──────────────────────────
function QuotesProvider({ children }) {
    const { isLogged } = useAuth();
    const { activeTab } = useUI();
    const { assetsRef } = useAssetsStructure();

    // 关键优化：独立高频状态，不触动全局 Assets 列表
    const [quotesMap, setQuotesMap] = useState({});
    const [intradayMap, setIntradayMap] = useState({});

    useRealtimeQuotes({
        activeTab,
        isLogged,
        assetsRef,
        setQuotesMap,
        setIntradayMap
    });

    const value = useMemo(() => ({
        quotesMap, intradayMap
    }), [quotesMap, intradayMap]);

    return <QuotesContext.Provider value={value}>{children}</QuotesContext.Provider>;
}

// ── 容器组件：实现分层 Provider 嵌套 ──────────────────────────────────
export function AssetProvider({ children }) {
    return (
        <AuthProvider>
            <UIProvider>
                <AssetsStructureProvider>
                    <QuotesProvider>
                        {children}
                    </QuotesProvider>
                </AssetsStructureProvider>
            </UIProvider>
        </AuthProvider>
    );
}

// ── 原子分类 Hooks 导出 ─────────────────────────────────────────────
export const useAuth = () => useContext(AuthContext);
export const useUI = () => useContext(UIContext);
export const useAssetsStructure = () => useContext(AssetsStructureContext);
export const useQuotes = () => useContext(QuotesContext);

/**
 * 向下兼容原有单一大 Hook，内部进行状态聚合
 * ⚠️ 注意：为了性能，此聚合 Hook 不再包含高频更新的 QuotesContext (quotesMap/intradayMap)
 * 依赖行情更新的组件请显式使用 useQuotes() 原子 Hook。
 */
export function useAsset() {
    const auth = useAuth();
    const ui = useUI();
    const struct = useAssetsStructure();

    return {
        ...auth,
        ...ui,
        ...struct
    };
}
