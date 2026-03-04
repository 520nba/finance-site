'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useAssetSync } from '@/hooks/useAssetSync';
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuotes';
import { fetchBulkNames } from '@/services/api/namesService';
import { fetchBulkStockQuotes } from '@/services/api/quotesService';
import { fetchBulkHistory } from '@/services/api/historyService';

const AssetContext = createContext(null);

export function AssetProvider({ children }) {
    const [activeTab, setActiveTab] = useState('stock'); // 默认页签
    const [selectedCode, setSelectedCode] = useState(null);
    const [toast, setToast] = useState(null);

    // 1. 认证状态
    const auth = useAuthSession();
    const { userId, isLogged } = auth;

    // 2. 资产同步 (Orchestrator Layer 1)
    const {
        assets,
        setAssets,
        isSyncing,
        setIsSyncing,
        assetsRef,
        refreshAssets
    } = useAssetSync({ userId, isLogged });

    // 3. 实时行情轮询 (Orchestrator Layer 2)
    // 只有在特定页签且登录状态下才启动
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

    // 核心业务逻辑：获取资产详情
    const getAssetDetails = useCallback(async (code, type) => {
        try {
            const nameMap = await fetchBulkNames([{ code, type }], true);
            const name = nameMap[`${type}:${code}`] ?? (type === 'fund' ? `基金 ${code}` : `股票 ${code}`);

            // 预加载历史数据（静默失败）
            fetchBulkHistory([{ code, type }], true, 250).catch(() => { });

            if (type === 'stock') {
                const quoteMap = await fetchBulkStockQuotes([{ code, type }], true);
                const q = quoteMap[code.toLowerCase()] || quoteMap[code];
                return { ...q, name: q?.name || name, code, type };
            }
            return { name, price: 0, code, type, history: [], changePercent: 0 };
        } catch (e) {
            console.error(`[AssetProvider] Details fetch failed:`, e);
            return null;
        }
    }, []);

    // 核心业务逻辑：添加资产
    const addAsset = useCallback(async (rawCode, typeHint) => {
        setIsSyncing(true);
        const code = rawCode.trim().toLowerCase();

        // 简单校验
        if (typeHint === 'stock' || activeTab === 'watchlist') {
            if (!/^[a-zA-Z]{2}\d{6}$/i.test(code)) {
                showToast('股票代码必须包含市场前缀 (如 sh600036)');
                setIsSyncing(false);
                return;
            }
        } else if (typeHint === 'fund') {
            if (!/^\d{6}$/.test(code)) {
                showToast('基金代码必须为 6 位数字');
                setIsSyncing(false);
                return;
            }
        }

        const asset = await getAssetDetails(code, typeHint);
        if (asset) {
            setAssets(prev => {
                const list = Array.isArray(prev) ? prev : [];
                if (list.find(a => a.code === code)) return list;
                return [...list, asset];
            });
        } else {
            showToast('加载失败，可能代码无效');
        }
        setIsSyncing(false);
    }, [activeTab, getAssetDetails, setIsSyncing, setAssets, showToast]);

    const removeAsset = useCallback((code) => {
        setAssets(prev => prev.filter(a => a.code !== code));
        if (selectedCode === code) setSelectedCode(null);
    }, [selectedCode, setAssets]);

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
