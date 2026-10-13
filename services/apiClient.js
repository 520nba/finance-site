/**
 * 集中式的 Fetch 请求器，能自动脱除 Envelope 包络，打印统一下游日志
 *
 * 2026-10 加固（P0）：
 *   1. 加超时。浏览器 fetch 默认不会超时，Worker 卡住时界面会永远停在加载态
 *      （实测 26 处裸 fetch）。这里统一走 fetchWithTimeout。
 *   2. res.json() 加保护。边缘 5xx 返回的是 HTML 错误页，直接 .json() 会抛出
 *      "Unexpected token '<'"，对排查毫无帮助。
 */
import { fetchWithTimeout, FetchTimeoutError } from '@/lib/client/fetchTimeout';

export async function apiClient(endpoint, options = {}, timeoutMs = 15000) {
    try {
        const res = await fetchWithTimeout(endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        }, timeoutMs);

        let json = null;
        try {
            json = await res.json();
        } catch {
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText || 'request failed'}`);
            throw new Error('Response is not valid JSON');
        }

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
        if (error instanceof FetchTimeoutError) {
            console.error(`[apiClient] Timeout after ${timeoutMs}ms for ${endpoint}`);
        } else {
            console.error(`[apiClient] Network request failed for ${endpoint}:`, error.message);
        }
        throw error;
    }
}
