/**
 * lib/client/fetchTimeout.js
 *
 * 客户端 fetch 超时包装。浏览器 fetch 默认**不会超时**，
 * 一旦 Worker 卡住或网络抖动，界面会永远停在加载态（实测 26 处裸 fetch）。
 *
 * 用 AbortController + setTimeout 实现（不依赖 AbortSignal.timeout，
 * 兼容性更宽），并在超时时抛出可识别的 TimeoutError。
 */

export class FetchTimeoutError extends Error {
    constructor(url, ms) {
        super(`请求超时（${ms}ms）: ${url}`);
        this.name = 'FetchTimeoutError';
        this.url = url;
        this.timeoutMs = ms;
    }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} ms 超时毫秒，默认 15s
 */
export async function fetchWithTimeout(url, init = {}, ms = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    // 调用方自己传了 signal 时，也要能联动取消
    const external = init.signal;
    if (external) {
        if (external.aborted) controller.abort();
        else external.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
        if (e?.name === 'AbortError') {
            if (external?.aborted) throw e;            // 调用方主动取消：原样抛出
            throw new FetchTimeoutError(url, ms);      // 超时：给一个可识别的错误
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}
