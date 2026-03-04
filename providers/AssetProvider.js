'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useAssetSync } from '@/hooks/useAssetSync';
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuotes';
import { useAssetActions } from '@/hooks/useAssetActions';

const AssetContext = createContext(null);

export function AssetProvider({ children }) {
    const [activeTab, setActiveTab] = useState('stock');
    const [selectedCode, setSelectedCode] = useState(null);
    const [toast, setToast] = useState(null);

    // Layer 1: 认证状态
    const auth = useAuthSession();
    const { userId, isLogged } = auth;

    // Layer 2: 资产同步（加载服务端数据 & KV 写回）
    const {
        assets,
        setAssets,
        isSyncing,
        setIsSyncing,
        assetsRef,
        refreshAssets,
        syncAssetsToServer
    } = useAssetSync({ userId, isLogged });

    // Layer 3: 实时行情轮询（仅在 watchlist tab 下启动）
    useRealtimeQuotes({
        activeTab,
        isLogged,
        assets,
        isSyncing,
        userId,
        setAssets,
        assetsRef,
        refreshAssets
    });

    const showToast = useCallback((msg, type = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    }, []);

    // Layer 4: 用户写操作（添加 / 移除资产）
    // 业务逻辑已下放至 useAssetActions，Provider 只负责传参和透出结果
    const { addAsset, removeAsset } = useAssetActions({
        activeTab,
        setAssets,
        setIsSyncing,
        showToast,
        selectedCode,
        setSelectedCode,
        syncAssetsToServer,
        assetsRef,
    });

    const value = useMemo(() => ({
        ...auth,
        assets,
        isSyncing,
        activeTab,
        setActiveTab,
        selectedCode,
        setSelectedCode,
        addAsset,
        removeAsset,
        refreshAssets: () => refreshAssets(assets.map(a => ({ code: a.code, type: a.type }))),
        toast,
        setToast,
        showToast
    }), [auth, assets, isSyncing, activeTab, selectedCode, addAsset, removeAsset, refreshAssets, toast, showToast]);

    return (
        <AssetContext.Provider value={value}>
            {children}
        </AssetContext.Provider>
    );
}

export function useAsset() {
    const context = useContext(AssetContext);
    if (!context) throw new Error('useAsset must be used within AssetProvider');
    return context;
}
