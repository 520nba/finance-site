import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage/kvClient';
import { getAssetNamesFromKV, saveAssetNamesToKV } from '@/lib/storage/nameRepo';
import { addSystemLog } from '@/lib/storage/logRepo';


const STORAGE_KEY = 'names_config';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/',
};

// remove unused resolveMarket

/**
 * 带有超时控制的 fetch 包装
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * 获取股票名称 — 使用 stock/get (f58)
 */
async function fetchStockName(code) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    let clean = code;
    let market = '1';
    if (match) {
        const prefix = match[1].toLowerCase();
        clean = match[2];
        if (prefix === 'sz') market = '0';
    }
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f58`;
        const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
        if (res.ok) {
            const json = await res.json();
            if (json.data?.f58) return json.data.f58;
        }
    } catch (e) {
        console.error(`[fetchStockName] Error fetching ${code}:`, e.message);
    }
    return null;
}

/**
 * 获取场外基金名称 — 使用天天基金 JSONP
 */
async function fetchFundName(code) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i);
    const clean = match ? match[2] : code;
    // 方案1: 腾讯财经 API (GBK 编码，最稳定的名称获取源，使用 Buffer 解析)
    try {
        const url = `https://qt.gtimg.cn/q=s_jj${clean}`;
        const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
        if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const text = new TextDecoder('gbk').decode(arrayBuffer);
            const parts = text.split('~');
            if (parts.length > 2 && parts[1]) {
                const name = parts[1].trim();
                // 腾讯财经有时候返回的带有冗余的后缀，直接返回
                return name;
            }
        }
    } catch (e) {
        console.warn(`[fetchFundName] Tencent fallback failed for ${code}:`, e.message);
    }

    // 方案2: 东财 lsjz API 回退 (UTF-8，从历史净值页提取基金名)
    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=1&_=${Date.now()}`;
        const res = await fetchWithTimeout(url, { headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' } });
        if (res.ok) {
            const data = await res.json();
            if (data.Expansion) return data.Expansion;
        }
    } catch (e) {
        console.warn(`[fetchFundName] EastMoney fallback failed for ${code}:`, e.message);
    }

    // 方案3: 解析天天基金网页版 HTML 的 title (最稳定兜底，专治 QDII/ETF)
    try {
        const url = `https://fund.eastmoney.com/${clean}.html`;
        const res = await fetchWithTimeout(url, { headers: { ...BASE_HEADERS, 'Accept': 'text/html' } }, 6000);
        if (res.ok) {
            const html = await res.text();
            // 一般 title 格式: <title>易方达原油A类人民币(003321)基金净值_估值...
            const titleMatch = html.match(/<title>([^<(]+)/);
            if (titleMatch && titleMatch[1]) {
                const name = titleMatch[1].trim();
                if (name && !name.includes('天天基金网')) return name;
            }
        }
    } catch (e) {
        console.warn(`[fetchFundName] HTML fallback failed for ${code}:`, e.message);
    }

    return null;
}

/**
 * 检测名称是否有效（乱码、404 错误页、或未抓取成功的占位符）
 */
function isInvalidName(name) {
    if (!name || typeof name !== 'string') return true;
    const clean = name.trim();
    if (clean.length === 0) return true;

    // 1. 明确的错误页特征 (针对东财跳转失败捕获的标题)
    const ERROR_PATTERNS = [
        '页面未找到',
        '404',
        'Bad Gateway',
        'Service Unavailable',
        'Cloudflare',
        'Internal Server Error',
        '东方财富网', // 如果名称里全是这个，可能是命中了错误页全局 Title
    ];
    if (ERROR_PATTERNS.some(p => clean.includes(p)) && clean.length < 20) return true;

    // 2. 如果名称就是代码本身（之前的 fallback），尝试重新抓取
    if (/^\d{6}$/.test(clean)) return true;

    // 3. 乱码特征：1. 带有 U+FFFD 替换字符 2. 大量非中文字符
    let badChars = 0;
    for (let i = 0; i < clean.length; i++) {
        const code = clean.charCodeAt(i);
        if (code === 0xFFFD) return true;
        if (code < 0x20 && code !== 0x0A && code !== 0x0D) badChars++;
        if (code >= 0xE000 && code <= 0xF8FF) badChars++;
    }

    return (badChars / clean.length) > 0.3;
}

export async function syncNamesBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    // 优先从 KV 获取
    const result = await getAssetNamesFromKV(items);
    const toFetch = [];

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        const name = result[key];
        if (!name || isInvalidName(name)) {
            // 名称缺失或属于非法占位符，触发全量重新拉取
            if (name) delete result[key];
            toFetch.push(item);
        }
    }

    if (toFetch.length > 0 && allowExternal) {
        const fetched = [];
        const CHUNK_SIZE = 10;
        for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
            const chunk = toFetch.slice(i, i + CHUNK_SIZE);
            const chunkFetched = await Promise.all(chunk.map(async (item) => {
                const key = `${item.type}:${item.code}`;
                let name = null;

                if (item.type === 'fund') {
                    name = await fetchFundName(item.code);
                } else {
                    name = await fetchStockName(item.code);
                }

                return { key, name };
            }));
            fetched.push(...chunkFetched);
        }

        let newNames = {};
        for (const { key, name } of fetched) {
            if (name) {
                result[key] = name;
                newNames[key] = name;
            }
        }
        if (Object.keys(newNames).length > 0) {
            await saveAssetNamesToKV(newNames);
            await addSystemLog('INFO', 'Names', `Cached ${Object.keys(newNames).length} new asset names to KV`);
        }
    }

    // 兜底：未找到名称的返回代码本身
    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key]) result[key] = item.code;
    }

    return result;
}

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        const result = await syncNamesBulk(items, allowExternal);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
