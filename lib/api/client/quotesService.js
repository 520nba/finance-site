import { apiClient } from '@/services/apiClient';

/**
 * 获取实时批量报价
 * @param {Array<object|string>} stocks 
 * @param {boolean} allowExternal 
 */
export async function fetchBulkStockQuotes(stocks, allowExternal = false) {
    if (!stocks || stocks.length === 0) return {};

    try {
        const data = await apiClient('/api/quotes/bulk', {
            method: 'POST',
            body: JSON.stringify({ items: stocks, allowExternal }),
        });
        return data || {};
    } catch (e) {
        // Fallback or empty object handled upstream, or we return {} here
        return {};
    }
}
