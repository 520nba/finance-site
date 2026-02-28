import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage';

export const runtime = 'edge';

const STORAGE_KEY = 'names_config';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
};

function resolveMarket(code) {
    const lower = code.toLowerCase();
    if (lower.startsWith('sh')) return { prefix: 'sh', clean: code.substring(2) };
    if (lower.startsWith('sz')) return { prefix: 'sz', clean: code.substring(2) };
    return { prefix: (code.startsWith('6') || code.startsWith('5')) ? 'sh' : 'sz', clean: code };
}

async function fetchStockNames(codes) {
    if (codes.length === 0) return {};
    const qtCodes = codes.map(c => {
        const { prefix, clean } = resolveMarket(c);
        return `${prefix}${clean}`;
    });
    try {
        const res = await fetch(`https://qt.gtimg.cn/q=${qtCodes.join(',')}`, { headers: BASE_HEADERS });
        if (!res.ok) throw new Error(`${res.status}`);
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
            const qtKey = line.substring(2, eqIdx);
            const matched = codes.find(c => {
                const { prefix, clean } = resolveMarket(c);
                return `${prefix}${clean}` === qtKey || `${prefix === 'sh' ? 'sz' : 'sh'}${clean}` === qtKey;
            });
            if (matched) result[matched] = parts[1];
        }
        return result;
    } catch (e) {
        return {};
    }
}

async function fetchFundName(code) {
    try {
        const res = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`, { headers: BASE_HEADERS });
        if (!res.ok) return null;
        const text = await res.text();
        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) {
            const json = JSON.parse(match[1]);
            return json.name || null;
        }
    } catch (e) { }
    return null;
}

export async function POST(request) {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({});
    const cache = await readDoc(STORAGE_KEY, {});
    const result = {};
    const stocksToFetch = [];
    const fundsToFetch = [];
    for (const { code, type } of items) {
        const key = `${type}:${code}`;
        if (cache[key]) result[key] = cache[key];
        else {
            result[key] = code;
            if (type === 'stock') stocksToFetch.push(code);
            else fundsToFetch.push(code);
        }
    }
    let cacheUpdated = false;
    if (stocksToFetch.length > 0) {
        const names = await fetchStockNames(stocksToFetch);
        for (const [code, name] of Object.entries(names)) {
            const key = `stock:${code}`;
            result[key] = name;
            cache[key] = name;
            cacheUpdated = true;
        }
    }
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
    if (cacheUpdated) await writeDoc(STORAGE_KEY, cache);
    return NextResponse.json(result);
}
