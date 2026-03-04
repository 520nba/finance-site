import { NextResponse } from 'next/server';
import { getBulkQuotesFromKV, saveQuotesToKV } from '@/lib/storage/quoteRepo';
import { addSystemLog } from '@/lib/storage/logRepo';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*, application/json',
    'Referer': 'https://quote.eastmoney.com/'
};

// 移除 resolveMarket，强制用户传前缀

// 🚀 使用腾讯财经 API 批量获取行情 (极速且支持大量代码单次请求)
async function fetchExternalBulkQuotes(stocks) {
    if (stocks.length === 0) return {};
    const result = {};
    const CHUNK_SIZE = 50; // 腾讯 API 支持极长 URL

    for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const q_params = chunk.map(code => code.toLowerCase()).join(',');

        try {
            const url = `https://qt.gtimg.cn/q=${q_params}`;
            const res = await fetch(url, { headers: { 'Referer': 'https://gu.qq.com/' } });
            if (!res.ok) continue;

            const arrayBuffer = await res.arrayBuffer();
            const text = new TextDecoder('gbk').decode(arrayBuffer);
            const lines = text.split(';').filter(l => l.trim());

            for (const line of lines) {
                const match = line.match(/v_([^=]+)="([^"]+)"/);
                if (!match) continue;
                const data = match[2].split('~');
                if (data.length < 6) continue;

                const code = match[1].toLowerCase();
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
    // 1. 从 KV 获取当前缓存
    const dbResult = await getBulkQuotesFromKV(codes);

    if (!allowExternal) {
        // 如果不允许外部访问，则直接返回缓存数据
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
            await saveQuotesToKV(dataToSave);
            await addSystemLog('INFO', 'Quotes', `Synced ${Object.keys(externalData).length} quotes (including staleness refresh)`);
        }
    }

    return dbResult;
}

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        const result = await syncQuotesBulk(items, allowExternal);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
