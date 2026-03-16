/**
 * lib/proxy/fetcher.js
 * 
 * 代理网络抓取封装
 */

import { EASTMONEY_HEADERS, TENCENT_HEADERS } from '@/lib/constants/headers';

const PROXY_TIMEOUT_MS = 10000;

/**
 * 按域名决定请求头
 * 
 * @param {URL} urlObj 
 */
function resolveHeaders(urlObj) {
    const host = urlObj.hostname;

    // 腾讯财经
    if (host.includes('gtimg.cn')) {
        return TENCENT_HEADERS;
    }

    // 东方财富系列
    if (host.includes('eastmoney.com') || host.includes('1234567.com.cn')) {
        return {
            ...EASTMONEY_HEADERS,
            'Referer': 'https://quote.eastmoney.com/'
        };
    }

    // 默认通用头
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
    };
}

/**
 * 执行代理抓取
 * 
 * @param {URL} urlObj 
 * @returns {{ response: Response, isGbk: boolean }}
 */
export async function proxyFetch(urlObj) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    try {
        const response = await fetch(urlObj.href, {
            headers: resolveHeaders(urlObj),
            signal: controller.signal,
        });

        // 识别编码特征：腾讯财经通常返回 GBK
        const isGbk = urlObj.hostname.includes('gtimg.cn');

        return { response, isGbk };
    } finally {
        clearTimeout(timer);
    }
}
