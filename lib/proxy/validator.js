/**
 * lib/proxy/validator.js
 * 
 * 代理请求安全校验
 */

// 允许代理的域名白名单，集中管理
// 说明：sina 系列在既有链路里已被使用（股票历史兜底 money.finance.sina.com.cn、
// 实时行情兜底 hq.sinajs.cn），加入白名单一是保持一致，二是便于从 Worker 内部
// 验证这些兜底源是否可达（hq.sinajs.cn 的注册域是 sinajs.cn，不是 sina.com.cn）。
const ALLOWED_DOMAINS = [
    'eastmoney.com',
    '1234567.com.cn',
    'gtimg.cn',
    'sina.com.cn',
    'sinajs.cn',
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

    // SSRF 防御增强：拒绝 IP 地址形式的 hostname（防止 DNS 重绑定到内网）
    const hostname = urlObj.hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === 'localhost' || hostname.startsWith('[')) {
        return { ok: false, error: 'IP-based targets forbidden', status: 403 };
    }

    return { ok: true, urlObj };
}
