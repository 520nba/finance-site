import { useCallback } from 'react';
import { fetchBulkNames } from '@/lib/api/client/namesService';
import { fetchBulkStockQuotes } from '@/lib/api/client/quotesService';
import { fetchBulkHistory } from '@/lib/api/client/historyService';

/**
 * 资产写操作 Hook（addAsset / removeAsset）
 * 职责：封装所有会改变 assets 列表的用户操作，
 * 让 AssetProvider 回归到纯粹的状态聚合层。
 */
export function useAssetActions({ activeTabRef, setAssets, setIsSyncing, showToast, selectedCodeRef, setSelectedCode, syncAssetsToServer, assetsRef }) {

    // 内部辅助：获取单个资产的完整描述信息（名称 + 实时报价）
    const getAssetDetails = useCallback(async (code, type) => {
        try {
            const nameMap = await fetchBulkNames([{ code, type }], true);
            const name = nameMap[`${type}:${code}`] ?? (type === 'fund' ? `基金 ${code}` : `股票 ${code}`);

            // 历史数据现在由后台定时任务补全，不再由前端新增时刻触发异步请求

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
     * 包含格式校验 -> 数据预加载 -> 去重写入
     */
    const addAsset = useCallback(async (rawCode, typeHint) => {
        setIsSyncing(true);
        const code = rawCode.trim().toLowerCase();
        const currentTab = activeTabRef.current;

        // 格式校验
        if (typeHint === 'stock' || currentTab === 'watchlist') {
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
            const list = Array.isArray(assetsRef.current) ? assetsRef.current : [];
            // 去重：已存在则不重复添加
            if (!list.find(a => a.code === code)) {
                const newList = [...list, asset];
                setAssets(newList);
                // 立即触发强制同步，避免依赖 useEffect 引发新旧状态竞态
                syncAssetsToServer(newList);
            }
        } else {
            showToast('加载失败，可能代码无效');
        }
        setIsSyncing(false);
    }, [activeTabRef, getAssetDetails, setIsSyncing, setAssets, showToast, assetsRef, syncAssetsToServer]);

    /**
     * 从自选列表移除资产
     * 同步清除侧边栏选中状态
     */
    const removeAsset = useCallback((code) => {
        const newList = assetsRef.current.filter(a => a.code !== code);
        setAssets(newList);
        syncAssetsToServer(newList);
        if (selectedCodeRef.current === code) setSelectedCode(null);
    }, [selectedCodeRef, setSelectedCode, assetsRef, setAssets, syncAssetsToServer]);

    return { addAsset, removeAsset };
}
