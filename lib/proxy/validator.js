/**
 * lib/proxy/validator.js
 * 
 * 代理请求安全校验
 */

// 允许代理的域名白名单，集中管理
export const ALLOWED_DOMAINS = [
    'eastmoney.com',
    '1234567.com.cn',
    'gtimg.cn',
];

/**
 * 校验目标 URL 是否允许代理
 * 
 * @param {string} rawUrl 原始 URL 字符串
 * @returns {{ ok: true, urlObj: URL } | { ok: false, error: string, status: number }}
 */
export function validateProxyTarget(rawUrl) {
    if (!rawUrl) {
        return { ok: false, error: 'Missing url', status: 400 };
    }

    let urlObj;
    try {
        urlObj = new URL(rawUrl);
    } catch {
        return { ok: false, error: 'Invalid url format', status: 400 };
    }

    // SSRF 基础防御：只允许 http 和 https 协议
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return { ok: false, error: 'Forbidden protocol', status: 403 };
    }

    // 域名白名单保护
    const allowed = ALLOWED_DOMAINS.some(
        domain => urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!allowed) {
        return { ok: false, error: 'Forbidden proxy target', status: 403 };
    }

    return { ok: true, urlObj };
}
