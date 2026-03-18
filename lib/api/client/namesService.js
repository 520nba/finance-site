import { apiClient } from '@/services/apiClient';

/**
 * 批量获取资产名称
 */
export async function fetchBulkNames(items, allowExternal = false) {
    if (!items || items.length === 0) return {};

    try {
        const data = await apiClient('/api/names/bulk', {
            method: 'POST',
            body: JSON.stringify({ items, allowExternal }),
        });
        return data || {};
    } catch (e) {
        return {};
    }
}
