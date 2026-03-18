import { useCallback } from 'react';
import { fetchBulkNames } from '@/lib/api/client/namesService';
import { fetchBulkStockQuotes } from '@/lib/api/client/quotesService';
import { fetchBulkHistory } from '@/lib/api/client/historyService';

/**
 * 璧勪骇鍐欐搷浣?Hook锛坅ddAsset / removeAsset锛?
 * 鑱岃矗锛氬皝瑁呮墍鏈変細鏀瑰彉 assets 鍒楄〃鐨勭敤鎴锋搷浣滐紝
 * 璁?AssetProvider 鍥炲綊鍒扮函绮圭殑鐘舵€佽仛鍚堝眰銆?
 */
export function useAssetActions({ activeTabRef, setAssets, setIsSyncing, showToast, selectedCodeRef, setSelectedCode, syncAssetsToServer, assetsRef }) {

    // 鍐呴儴杈呭姪锛氳幏鍙栧崟涓祫浜х殑瀹屾暣鎻忚堪淇℃伅锛堝悕绉?+ 瀹炴椂鎶ヤ环锛?
    const getAssetDetails = useCallback(async (code, type) => {
        try {
            const nameMap = await fetchBulkNames([{ code, type }], true);
            const name = nameMap[`${type}:${code}`] ?? (type === 'fund' ? `鍩洪噾 ${code}` : `鑲＄エ ${code}`);

            // 鍘嗗彶鏁版嵁鐜板湪鐢卞悗鍙板畾鏃朵换鍔¤ˉ鍏紝涓嶅啀鐢卞墠绔柊澧炴椂鍒昏Е鍙戝紓姝ヨ姹?

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
     * 娣诲姞璧勪骇鍒拌嚜閫夊垪琛?
     * 鍖呭惈鏍煎紡鏍￠獙 鈫?鏁版嵁棰勫姞杞?鈫?鍘婚噸鍐欏叆
     */
    const addAsset = useCallback(async (rawCode, typeHint) => {
        setIsSyncing(true);
        const code = rawCode.trim().toLowerCase();
        const currentTab = activeTabRef.current;

        // 鏍煎紡鏍￠獙
        if (typeHint === 'stock' || currentTab === 'watchlist') {
            if (!/^[a-zA-Z]{2}\d{6}$/i.test(code)) {
                showToast('鑲＄エ浠ｇ爜蹇呴』鍖呭惈甯傚満鍓嶇紑 (濡?sh600036)');
                setIsSyncing(false);
                return;
            }
        } else if (typeHint === 'fund') {
            if (!/^\d{6}$/.test(code)) {
                showToast('鍩洪噾浠ｇ爜蹇呴』涓?6 浣嶆暟瀛?);
                setIsSyncing(false);
                return;
            }
        }

        const asset = await getAssetDetails(code, typeHint);
        if (asset) {
            const list = Array.isArray(assetsRef.current) ? assetsRef.current : [];
            // 鍘婚噸锛氬凡瀛樺湪鍒欎笉閲嶅娣诲姞
            if (!list.find(a => a.code === code)) {
                const newList = [...list, asset];
                setAssets(newList);
                // 绔嬪嵆瑙﹀彂寮哄埗鍚屾锛岄伩鍏嶄緷璧?useEffect 寮曞彂鏂版棫鐘舵€佺珵鎬?
                syncAssetsToServer(newList);
            }
        } else {
            showToast('鍔犺浇澶辫触锛屽彲鑳戒唬鐮佹棤鏁?);
        }
        setIsSyncing(false);
    }, [activeTabRef, getAssetDetails, setIsSyncing, setAssets, showToast, assetsRef, syncAssetsToServer]);

    /**
     * 浠庤嚜閫夊垪琛ㄧЩ闄よ祫浜?
     * 鍚屾娓呴櫎渚ц竟鏍忛€変腑鐘舵€?
     */
    const removeAsset = useCallback((code) => {
        const newList = assetsRef.current.filter(a => a.code !== code);
        setAssets(newList);
        syncAssetsToServer(newList);
        if (selectedCodeRef.current === code) setSelectedCode(null);
    }, [selectedCodeRef, setSelectedCode, assetsRef, setAssets, syncAssetsToServer]);

    return { addAsset, removeAsset };
}
