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

async function fetchNamesEastMoney(items) {
    if (items.length === 0) return {};

    // 东方财富 UList API 支持批量获取名称 (UTF-8 JSON)
    const secids = items.map(item => {
        const { market, code } = resolveMarket(item.code);
        return `${market}.${code}`;
    }).join(',');

    try {
        const url = `https://push2.eastmoney.com/api/qt/ulist/get?secids=${secids}&fields=f12,f14`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return {};
        const json = await res.json();
        const list = json.data?.diff || [];
        const result = {};

        // 映射结果
        list.forEach(node => {
            const code = node.f12;
            const name = node.f14;
            // 找到原始请求中的 key
            const matched = items.find(i => i.code.includes(code));
            if (matched) {
                result[`${matched.type}:${matched.code}`] = name;
            }
        });

        // 处理场外基金 (上述 API 主要针对场内)
        const fundsToFetch = items.filter(i => i.type === 'fund' && !result[`${i.type}:${i.code}`]);
        if (fundsToFetch.length > 0) {
            const fundNames = await Promise.all(fundsToFetch.map(async (f) => {
                try {
                    const fRes = await fetch(`https://fundgz.1234567.com.cn/js/${f.code}.js?_=${Date.now()}`, { headers: BASE_HEADERS });
                    const text = await fRes.text();
                    const match = text.match(/jsonpgz\((.+)\)/);
                    if (match) return JSON.parse(match[1]).name;
                } catch { }
                return null;
            }));
            fundNames.forEach((name, i) => {
                if (name) result[`fund:${fundsToFetch[i].code}`] = name;
            });
        }

        return result;
    } catch (e) {
        console.error('[Names] EastMoney bulk failed:', e.message);
        return {};
    }
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
        const newNames = await fetchNamesEastMoney(toFetch);
        let cacheUpdated = false;
        for (const [key, name] of Object.entries(newNames)) {
            result[key] = name;
            cache[key] = name;
            cacheUpdated = true;
        }
        if (cacheUpdated) await writeDoc(STORAGE_KEY, cache);
    }

    // 补全兜底：如果还是没找到名称，返回原始代码
    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key]) result[key] = item.code;
    }

    return NextResponse.json(result);
}
