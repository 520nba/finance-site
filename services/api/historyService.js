import { apiClient } from '../apiClient';

/**
 * 获取批量资产的历史 K 线与净值 (合并了原先分散的史数据抓取)
 * @param {Array<object>} items - 结构 [{ type: 'stock'|'fund', code: '...' }]
 * @param {boolean} allowExternal 
 * @param {number} days 
 */
export async function fetchBulkHistory(items, allowExternal = false, days = 250) {
    if (!items || items.length === 0) return {};

    try {
        const data = await apiClient('/api/history/bulk', {
            method: 'POST',
            body: JSON.stringify({ items, days, allowExternal }),
        });
        return data || {};
    } catch (e) {
        return {};
    }
}
