import { useCallback } from 'react';
import { fetchBulkNames } from '@/services/api/namesService';
import { fetchBulkStockQuotes } from '@/services/api/quotesService';
import { fetchBulkHistory } from '@/services/api/historyService';

/**
 * 资产写操作 Hook（addAsset / removeAsset）
 * 职责：封装所有会改变 assets 列表的用户操作，
 * 让 AssetProvider 回归到纯粹的状态聚合层。
 */
export function useAssetActions({ activeTab, setAssets, setIsSyncing, showToast, selectedCode, setSelectedCode, syncAssetsToServer }) {

    // 内部辅助：获取单个资产的完整描述信息（名称 + 实时报价）
    const getAssetDetails = useCallback(async (code, type) => {
        try {
            const nameMap = await fetchBulkNames([{ code, type }], true);
            const name = nameMap[`${type}:${code}`] ?? (type === 'fund' ? `基金 ${code}` : `股票 ${code}`);

            // 预加载历史数据（静默失败，不阻塞主流程）
            fetchBulkHistory([{ code, type }], true, 250).catch(() => { });

            if (type === 'stock') {
                const quoteMap = await fetchBulkStockQuotes([{ code, type }], true);
                const q = quoteMap[code.toLowerCase()] || quoteMap[code];
                return { ...q, name: q?.name || name, code, type };
            }
            return { name, price: 0, code, type, history: [], changePercent: 0 };
        } catch (e) {
            console.error('[useAssetActions] Details fetch failed:', e);
            return null;
        }
    }, []);

    /**
     * 添加资产到自选列表
     * 包含格式校验 → 数据预加载 → 去重写入
     */
    const addAsset = useCallback(async (rawCode, typeHint) => {
        setIsSyncing(true);
        const code = rawCode.trim().toLowerCase();

        // 格式校验
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
                // 去重：已存在则不重复添加
                if (list.find(a => a.code === code)) return list;
                return [...list, asset];
            });
        } else {
            showToast('加载失败，可能代码无效');
        }
        setIsSyncing(false);
    }, [activeTab, getAssetDetails, setIsSyncing, setAssets, showToast]);

    /**
     * 从自选列表移除资产
     * 同步清除侧边栏选中状态
     */
    const removeAsset = useCallback((code) => {
        setAssets(prev => {
            const newList = prev.filter(a => a.code !== code);
            // 立即触发强制同步，确保此时后端也删除成功，防止刷新复现
            syncAssetsToServer(newList);
            return newList;
        });
        if (selectedCode === code) setSelectedCode(null);
    }, [selectedCode, setAssets, setSelectedCode, syncAssetsToServer]);

    return { addAsset, removeAsset };
}
