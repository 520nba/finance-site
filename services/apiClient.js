import { logger } from '@/lib/logger';

/**
 * 集中式的 Fetch 请求器，能自动脱除 Envelope 包络，打印统一下游日志
 */
export async function apiClient(endpoint, options = {}) {
    try {
        const res = await fetch(endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        const json = await res.json();

        // 适配后端的标准包裹体 { success, data, error, code }
        if (!res.ok || json.success === false) {
            const errMsg = json.error || `HTTP ${res.status}: ${res.statusText}`;
            throw new Error(errMsg);
        }

        // 后端如果遵照了 Envelope 格式返回 data，自动扒衣
        if (json.success === true && json.data !== undefined) {
            return json.data;
        }

        return json;
    } catch (error) {
        logger.error(`[apiClient] Network request failed for ${endpoint}`, error, { endpoint, method: options.method || 'GET' });
        throw error;
    }
}
