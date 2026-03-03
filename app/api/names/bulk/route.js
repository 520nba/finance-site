import { NextResponse } from 'next/server';
import { readDoc, writeDoc, getAssetNamesFromDB, saveAssetNamesToDB, addSystemLog } from '@/lib/storage';


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
    const clean = code.replace(/^(sh|sz)/i, '');
    for (const market of ['0', '1']) {
        try {
            const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f58`;
            const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
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
        const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;

        const arrayBuffer = await res.arrayBuffer();
        const text = new TextDecoder('gbk').decode(arrayBuffer);

        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) {
            try {
                const data = JSON.parse(match[1]);
                return data.name;
            } catch (e) {
                const nameMatch = match[1].match(/"name":"([^"]+)"/);
                if (nameMatch) return nameMatch[1];
            }
        }
    } catch (e) { }
    return null;
}

export async function syncNamesBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext();
    if (env?.DB) {
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS asset_names (
                code TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(code, type)
            );
        `).run();
    }

    // 优先从 DB (D1) 获取
    const result = await getAssetNamesFromDB(items);
    const toFetch = [];

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key]) {
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
            await saveAssetNamesToDB(newNames);
            await addSystemLog('INFO', 'Names', `Cached ${Object.keys(newNames).length} new asset names to DB`);
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
