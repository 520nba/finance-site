import { NextResponse } from 'next/server';
import { readDoc, writeDoc, getAssetNamesFromKV, saveAssetNamesToKV, addSystemLog } from '@/lib/storage';


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
    // 方案1: 天天基金 JSONP (GBK 编码，需要手动解码)
    try {
        const url = `https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`;
        const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
        if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const text = new TextDecoder('gbk').decode(arrayBuffer);
            const match = text.match(/jsonpgz\((.+)\)/);
            if (match) {
                try {
                    const data = JSON.parse(match[1]);
                    if (data.name) return data.name;
                } catch (e) {
                    const nameMatch = match[1].match(/"name":"([^"]+)"/);
                    if (nameMatch) return nameMatch[1];
                }
            }
        }
    } catch (e) {
        console.warn(`[fetchFundName] JSONP failed for ${code}:`, e.message);
    }

    // 方案2: 东财 lsjz API 回退 (UTF-8，从历史净值页提取基金名)
    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1&_=${Date.now()}`;
        const res = await fetchWithTimeout(url, { headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' } });
        if (res.ok) {
            const data = await res.json();
            if (data.Expansion) return data.Expansion;
        }
    } catch (e) {
        console.warn(`[fetchFundName] EastMoney fallback failed for ${code}:`, e.message);
    }
    return null;
}

/**
 * 检测名称是否为乱码（含大量不可打印字符或 mojibake 特征）
 */
function isGarbled(name) {
    if (!name || typeof name !== 'string') return true;
    // 统计不可识别字符的比例，正常中文名不该包含大量特殊替换字符
    let badChars = 0;
    for (const ch of name) {
        const code = ch.charCodeAt(0);
        // 替换字符 U+FFFD 或控制字符（除常规空格外）
        if (code === 0xFFFD || (code < 0x20 && code !== 0x0A && code !== 0x0D)) badChars++;
    }
    return badChars > 0 || name.length === 0;
}

export async function syncNamesBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    // 优先从 KV 获取
    const result = await getAssetNamesFromKV(items);
    const toFetch = [];

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key] || isGarbled(result[key])) {
            // 名称缺失或乱码，都需要重新抓取
            if (result[key]) delete result[key];
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
                    if (!name) {
                        name = await fetchStockName(item.code);
                    }
                } else {
                    name = await fetchStockName(item.code);
                    if (!name) {
                        name = await fetchFundName(item.code);
                    }
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
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
