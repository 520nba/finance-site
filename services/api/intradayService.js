import { apiClient } from '../apiClient';

/**
 * 批量获取资产的分时行情数据
 */
export async function fetchBulkIntradayData(items, allowExternal = false) {
    if (!items || items.length === 0) return {};

    try {
        const data = await apiClient('/api/intraday/bulk', {
            method: 'POST',
            body: JSON.stringify({ items, allowExternal }),
        });
        return data || {};
    } catch (e) {
        return {};
    }
}
