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

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        if (!Array.isArray(items) || items.length === 0) return NextResponse.json({});

        // 尝试初始化系统表
        const { getCloudflareContext } = await import('@opennextjs/cloudflare');
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            await env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS asset_quotes (
                    code TEXT PRIMARY KEY,
                    name TEXT,
                    price REAL,
                    change REAL,
                    changePercent REAL,
                    prevClose REAL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `).run();
        }

        const codes = items.map(it => typeof it === 'string' ? it : it.code);
        // 1. 从 DB 获取当前缓存
        const dbResult = await getBulkQuotesFromDB(codes);

        if (!allowExternal) {
            // 如果不允许外部访问，则直接返回 DB 数据
            return NextResponse.json(dbResult);
        }

        // 2. 否则，对于缺失的数据，进行外部补全（通常发生在添加新股票时）
        const missingCodes = codes.filter(code => !dbResult[code]);
        if (missingCodes.length > 0) {
            const externalData = await fetchExternalBulkQuotes(missingCodes);
            if (Object.keys(externalData).length > 0) {
                await saveQuotesToDB(externalData);
                await addSystemLog('INFO', 'Quotes', `Fetched & cached ${Object.keys(externalData).length} new quotes to DB`);

                for (const [k, v] of Object.entries(externalData)) {
                    dbResult[k] = v;
                }
            }
        }

        return NextResponse.json(dbResult);

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
