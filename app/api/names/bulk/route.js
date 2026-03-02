import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage';


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
    const clean = code.replace(/^(sh|sz)/i, '');
    // 尝试两个市场标识符，确保覆盖全
    for (const market of ['0', '1']) {
        try {
            const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f58`;
            const res = await fetch(url, { headers: BASE_HEADERS });
            if (!res.ok) continue;
            const json = await res.json();
            if (json.data?.f58) return json.data.f58;
        } catch (e) { }
    }
    return null;
}

/**
 * 获取场外基金名称 — 使用天天基金 JSONP
 */
async function fetchFundName(code) {
    try {
        const url = `https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;

        // 天天基金返回的是 GBK 编码，需手动解码
        const arrayBuffer = await res.arrayBuffer();
        const text = new TextDecoder('gbk').decode(arrayBuffer);

        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) {
            try {
                const data = JSON.parse(match[1]);
                return data.name;
            } catch (e) {
                // 如果 JSON.parse 失败，尝试正则提取
                const nameMatch = match[1].match(/"name":"([^"]+)"/);
                if (nameMatch) return nameMatch[1];
            }
        }
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
