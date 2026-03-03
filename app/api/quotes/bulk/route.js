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

// 🚀 使用腾讯财经 API 批量获取行情 (极速且支持大量代码单次请求)
async function fetchExternalBulkQuotes(stocks) {
    if (stocks.length === 0) return {};
    const result = {};
    const CHUNK_SIZE = 50; // 腾讯 API 支持极长 URL

    for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const q_params = chunk.map(code => {
            const clean = code.replace(/^(sh|sz)/i, '');
            const prefix = (clean.startsWith('6') || clean.startsWith('5') || clean.startsWith('11') || clean.startsWith('51')) ? 'sh' : 'sz';
            return `${prefix}${clean}`;
        }).join(',');

        try {
            const url = `https://qt.gtimg.cn/q=${q_params}`;
            const res = await fetch(url, { headers: { 'Referer': 'https://gu.qq.com/' } });
            if (!res.ok) continue;

            // 腾讯 API 返回的是 GBK 编码字符串，但在 Cloudflare 环境直接解码通常可用
            const text = await res.text();
            const lines = text.split(';').filter(l => l.trim());

            for (const line of lines) {
                const match = line.match(/v_([^=]+)="([^"]+)"/);
                if (!match) continue;
                const data = match[2].split('~');
                if (data.length < 6) continue;

                const code = data[2];
                result[code] = {
                    name: data[1],
                    code: code,
                    price: parseFloat(data[3]) || 0,
                    change: parseFloat(data[31]) || 0,
                    changePercent: parseFloat(data[32]) || 0,
                    prevClose: parseFloat(data[4]) || 0
                };
            }
        } catch (e) {
            console.error(`[API] Tencent Fetch failed:`, e.message);
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
