import { NextResponse } from 'next/server';
import { getBulkQuotesFromDB, saveQuotesToDB, addSystemLog } from '@/lib/storage';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*, application/json',
    'Referer': 'https://quote.eastmoney.com/'
};

function resolveMarket(code) {
    const clean = code.replace(/^(sh|sz)/i, '');
    let market = '1'; // 默认 SH
    if (code.toLowerCase().startsWith('sz')) {
        market = '0';
    } else if (!code.toLowerCase().startsWith('sh')) {
        market = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    }
    return { market, clean };
}

// 模拟之前 lib/api.js 里的 external fetch
async function fetchExternalBulkQuotes(stocks) {
    if (stocks.length === 0) return {};
    const result = {};
    const CHUNK_SIZE = 20;

    for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const secids = chunk.map(code => {
            const { market, clean } = resolveMarket(code);
            return `${market}.${clean}`;
        }).join(',');

        try {
            const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f12,f14,f2,f3,f15,f16,f17,f18`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { headers: BASE_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timeout));
            if (!res.ok) continue;

            const json = await res.json();
            if (json.data && json.data.diff) {
                for (const item of json.data.diff) {
                    if (!item || !item.f12) continue;
                    const code = item.f12;
                    result[code] = {
                        name: item.f14,
                        code: code,
                        price: (item.f2 !== undefined && item.f2 !== '-') ? item.f2 / 100 : 0,
                        change: (item.f16 !== undefined && item.f16 !== '-') ? item.f16 / 100 : 0,
                        changePercent: (item.f3 !== undefined && item.f3 !== '-') ? item.f3 / 100 : 0,
                        prevClose: (item.f18 !== undefined && item.f18 !== '-') ? item.f18 / 100 : 0
                    };
                }
            }
        } catch (e) {
            console.error(`[API] fetchExternalBulkQuotes chunk failed:`, e.message);
        }
    }
    return result;
}

export async function syncQuotesBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};



    const codes = items.map(it => typeof it === 'string' ? it : it.code);
    // 1. 从 DB 获取当前缓存
    const dbResult = await getBulkQuotesFromDB(codes);

    if (!allowExternal) {
        // 如果不允许外部访问，则直接返回 DB 数据
        return dbResult;
    }

    // 2. 否则，对于缺失或过期的数据，进行外部补全
    const now = Date.now();
    const toFetch = codes.filter(code => {
        if (!dbResult[code]) return true;
        // 如果数据超过 1 分钟，且允许外部访问，则认为已过期
        const updatedAt = dbResult[code].updated_at ? new Date(dbResult[code].updated_at).getTime() : 0;
        return now - updatedAt > 60000;
    });

    if (toFetch.length > 0) {
        const externalData = await fetchExternalBulkQuotes(toFetch);
        if (Object.keys(externalData).length > 0) {
            const timeStr = new Date().toISOString();
            const dataToSave = {};
            for (const [k, v] of Object.entries(externalData)) {
                const enriched = { ...v, updated_at: timeStr };
                dataToSave[k] = enriched;
                dbResult[k] = enriched;
            }
            await saveQuotesToDB(dataToSave);
            await addSystemLog('INFO', 'Quotes', `Synced ${Object.keys(externalData).length} quotes (including staleness refresh)`);
        }
    }

    return dbResult;
}

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        const result = await syncQuotesBulk(items, allowExternal);
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
