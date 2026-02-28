import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage';

export const runtime = 'edge';

const STORAGE_KEY = 'names_config';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/',
};

function resolveMarket(code) {
    const clean = code.replace(/^(sh|sz)/i, '');
    if (code.toLowerCase().startsWith('sh')) return { market: '1', code: clean };
    if (code.toLowerCase().startsWith('sz')) return { market: '0', code: clean };
    const prefix = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    return { market: prefix, code: clean };
}

/**
 * 获取股票名称 — 使用 stock/get (f58)
 */
async function fetchStockName(code) {
    const { market, code: clean } = resolveMarket(code);
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f58`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;
        const json = await res.json();
        return json.data?.f58 || null;
    } catch (e) {
        return null;
    }
}

/**
 * 获取场外基金名称 — 使用天天基金 JSONP
 */
async function fetchFundName(code) {
    try {
        const url = `https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;
        const text = await res.text();
        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) return JSON.parse(match[1]).name;
    } catch (e) { }
    return null;
}

export async function POST(request) {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({});

    const cache = await readDoc(STORAGE_KEY, {});
    const result = {};
    const toFetch = [];

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (cache[key]) {
            result[key] = cache[key];
        } else {
            toFetch.push(item);
        }
    }

    if (toFetch.length > 0) {
        const fetched = await Promise.all(toFetch.map(async (item) => {
            const key = `${item.type}:${item.code}`;
            let name = null;

            if (item.type === 'fund') {
                // 先试天天基金
                name = await fetchFundName(item.code);
                // 回退到 stock/get（场内 ETF）
                if (!name) name = await fetchStockName(item.code);
            } else {
                // 股票：直接 stock/get
                name = await fetchStockName(item.code);
            }

            return { key, name };
        }));

        let cacheUpdated = false;
        for (const { key, name } of fetched) {
            if (name) {
                result[key] = name;
                cache[key] = name;
                cacheUpdated = true;
            }
        }
        if (cacheUpdated) await writeDoc(STORAGE_KEY, cache);
    }

    // 兜底：未找到名称的返回代码本身
    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key]) result[key] = item.code;
    }

    return NextResponse.json(result);
}
