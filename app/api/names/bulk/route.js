import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CACHE_PATH = path.join(process.cwd(), 'data', 'names_cache.json');

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
};

async function readCache() {
    try {
        return JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
    } catch {
        return {};
    }
}

async function writeCache(cache) {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function resolveMarket(code) {
    const lower = code.toLowerCase();
    if (lower.startsWith('sh')) return { prefix: 'sh', clean: code.substring(2) };
    if (lower.startsWith('sz')) return { prefix: 'sz', clean: code.substring(2) };
    return { prefix: (code.startsWith('6') || code.startsWith('5')) ? 'sh' : 'sz', clean: code };
}

// 批量获取股票名称（qtimg 多码查询，GBK → UTF-8 解码）
async function fetchStockNames(codes) {
    if (codes.length === 0) return {};
    const qtCodes = codes.map(c => {
        const { prefix, clean } = resolveMarket(c);
        return `${prefix}${clean}`;
    });
    try {
        const res = await fetch(`https://qt.gtimg.cn/q=${qtCodes.join(',')}`, { headers: BASE_HEADERS });
        if (!res.ok) throw new Error(`${res.status}`);
        // qtimg 返回 GBK，Node fetch 默认 latin1，需手动解码
        const buf = await res.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buf);
        const result = {};
        const lines = text.split(';').map(s => s.trim()).filter(s => s.startsWith('v_'));
        for (const line of lines) {
            const eqIdx = line.indexOf('=');
            if (eqIdx === -1) continue;
            const value = line.substring(eqIdx + 2, line.length - 1);
            const parts = value.split('~');
            if (parts.length < 2 || !parts[1] || value.includes('pv_none')) continue;
            // 从 qtCode 映射回原始 code
            const qtKey = line.substring(2, eqIdx); // e.g. sh600036
            const matched = codes.find(c => {
                const { prefix, clean } = resolveMarket(c);
                return `${prefix}${clean}` === qtKey ||
                    `${prefix === 'sh' ? 'sz' : 'sh'}${clean}` === qtKey;
            });
            if (matched) {
                result[matched] = parts[1];
                console.log(`[Names] Fetched stock: ${matched} -> ${parts[1]}`);
            }
        }
        return result;
    } catch (e) {
        console.error(`[Names] qtimg batch failed for codes [${codes.join(',')}]:`, e.message);
        return {};
    }
}

// 获取单个基金名称（fundgz JSONP）
async function fetchFundName(code) {
    try {
        const res = await fetch(
            `https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`,
            { headers: BASE_HEADERS }
        );
        if (!res.ok) return null;
        const text = await res.text();
        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) {
            const json = JSON.parse(match[1]);
            if (json.name) return json.name;
        }
    } catch (e) {
        console.warn(`[Names] fundgz ${code} failed:`, e.message);
    }
    return null;
}

/**
 * POST /api/names/bulk
 * Body: { items: [{code, type}] }
 * Response: { "600036": "招商银行", "012831": "南方中证新能源ETF联接A", ... }
 * 名称缓存永久有效（名称几乎不变），只有未命中时才重新请求
 */
export async function POST(request) {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({});
    }

    const cache = await readCache();
    const result = {};
    const stocksToFetch = [];
    const fundsToFetch = [];

    // 分离：命中缓存 vs 需要抓取
    for (const { code, type } of items) {
        const key = `${type}:${code}`;
        if (cache[key]) {
            result[key] = cache[key];
        } else {
            result[key] = code; // 默认降级为代码
            if (type === 'stock') {
                stocksToFetch.push(code);
            } else {
                fundsToFetch.push(code);
            }
        }
    }

    let cacheUpdated = false;

    // 批量抓取股票名称（1次请求）
    if (stocksToFetch.length > 0) {
        const names = await fetchStockNames(stocksToFetch);
        for (const [code, name] of Object.entries(names)) {
            const key = `stock:${code}`;
            result[key] = name;
            cache[key] = name;
            cacheUpdated = true;
        }
    }

    // 并发抓取基金名称
    if (fundsToFetch.length > 0) {
        const names = await Promise.all(fundsToFetch.map(fetchFundName));
        fundsToFetch.forEach((code, i) => {
            if (names[i]) {
                const key = `fund:${code}`;
                result[key] = names[i];
                cache[key] = names[i];
                cacheUpdated = true;
            }
        });
    }

    if (cacheUpdated) {
        try {
            await writeCache(cache);
            console.log(`[Names] Cached ${Object.keys(cache).length} names total`);
        } catch (e) {
            console.error('[Names] Write cache failed:', e.message);
        }
    }

    console.log(`[Names] Served ${items.length} items (${items.length - stocksToFetch.length - fundsToFetch.length} cached)`);
    return NextResponse.json(result);
}
