import { NextResponse } from 'next/server';
import { readDoc, writeDoc, insertDailyPrice, insertDailyPricesBatch } from '@/lib/storage';

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// ── 外部数据获取（服务端直连）──────────────────────────────────────
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
};

function resolveMarket(code) {
    const lower = code.toLowerCase();
    if (lower.startsWith('sh')) return { prefix: 'sh', clean: code.substring(2) };
    if (lower.startsWith('sz')) return { prefix: 'sz', clean: code.substring(2) };
    return { prefix: (code.startsWith('6') || code.startsWith('5')) ? 'sh' : 'sz', clean: code };
}

function calcStats(history) {
    if (!history || history.length < 2) return { perf5d: 0, perf22d: 0, perf250d: 0 };
    const getPerf = (days) => {
        const data = history.slice(-(days + 1));
        if (data.length < 2) return 0;
        return ((data[data.length - 1].value / data[0].value) - 1) * 100;
    };
    return {
        perf5d: getPerf(5),
        perf22d: getPerf(22),
        perf250d: getPerf(250)
    };
}

function parseSinaKlines(jsonData, days) {
    if (!Array.isArray(jsonData)) return null;
    const result = jsonData
        .map(item => ({ date: item.day, value: parseFloat(item.close) }))
        .filter(i => i.date && !isNaN(i.value));
    return result.length > 0 ? result.slice(-days) : null;
}

async function fetchStockHistoryServer(code, days) {
    const { prefix, clean } = resolveMarket(code);
    const candidates = [`${prefix}${clean}`, `${prefix === 'sh' ? 'sz' : 'sh'}${clean}`];
    for (const sinaCode of candidates) {
        try {
            const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=${days + 10}`;
            const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://finance.sina.com.cn/' } });
            if (!res.ok) continue;
            const text = await res.text();
            const cleaned = text.replace(/^\uFEFF/, '').trim();
            if (!cleaned || cleaned === 'null') continue;
            const data = parseSinaKlines(JSON.parse(cleaned), days);
            if (data) return data;
        } catch (e) {
            console.warn(`[Bulk] Sina stock ${code} failed:`, e.message);
        }
    }
    return null;
}

async function fetchFundHistoryServer(code, days) {
    // 方案 A：新浪 K 线（上市 ETF）
    for (const sinaCode of [`sz${code}`, `sh${code}`]) {
        try {
            const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=${days + 10}`;
            const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://finance.sina.com.cn/' } });
            if (!res.ok) continue;
            const text = await res.text();
            const cleaned = text.replace(/^\uFEFF/, '').trim();
            if (!cleaned || cleaned === 'null') continue;
            const data = parseSinaKlines(JSON.parse(cleaned), days);
            if (data) return data;
        } catch (e) {
            console.warn(`[Bulk] Sina fund ${code} failed:`, e.message);
        }
    }

    // 方案 B：东财 lsjz（非上市开放式基金）
    try {
        const probeRes = await fetch(
            `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=20&_=${Date.now()}`,
            { headers: { ...BASE_HEADERS, 'Referer': `http://fundf10.eastmoney.com/jjjz_${code}.html` } }
        );
        if (!probeRes.ok) throw new Error(`probe ${probeRes.status}`);
        const probeData = await probeRes.json();
        const totalCount = probeData.TotalCount || 0;
        if (totalCount === 0) return null;

        const firstPage = probeData.Data?.LSJZList || [];
        const targetCount = Math.min(days, totalCount);
        const pagesNeeded = Math.ceil(targetCount / 20);

        const pagePromises = [];
        for (let page = 2; page <= pagesNeeded; page++) {
            pagePromises.push(
                fetch(
                    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=20&_=${Date.now()}`,
                    { headers: { ...BASE_HEADERS, 'Referer': `http://fundf10.eastmoney.com/jjjz_${code}.html` } }
                ).then(r => r.ok ? r.json() : null)
            );
        }
        const pageResults = await Promise.all(pagePromises);
        const allData = [...firstPage];
        for (const result of pageResults) {
            if (result?.Data?.LSJZList) allData.push(...result.Data.LSJZList);
        }
        if (allData.length > 0) {
            return allData
                .slice(0, targetCount)
                .map(item => ({ date: item.FSRQ, value: parseFloat(item.DWJZ) }))
                .filter(i => !isNaN(i.value))
                .reverse();
        }
    } catch (e) {
        console.error(`[Bulk] Fund lsjz ${code} failed:`, e.message);
    }
    return null;
}

export async function POST(request) {
    const { items, days = 250 } = await request.json();
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({});

    const today = todayStr();
    const result = {};
    const toFetch = [];

    // 并行读取缓存
    const cacheResults = await Promise.all(items.map(async ({ code, type }) => {
        const key = `${type}:${code}`;
        const storageKey = `hist:${type}:${code}`;
        const entry = await readDoc(storageKey, null);
        return { key, code, type, entry };
    }));

    for (const { key, code, type, entry } of cacheResults) {
        if (entry && entry.date === today && Array.isArray(entry.history) && entry.history.length >= days * 0.7) {
            result[key] = { history: entry.history, summary: calcStats(entry.history) };
        } else {
            toFetch.push({ code, type, key });
        }
    }

    if (toFetch.length > 0) {
        // 在服务端并发拉取历史数据，加入 Chunk 防并发洪峰
        const fetched = [];
        const CHUNK_SIZE = 15;
        for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
            const chunk = toFetch.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(
                chunk.map(async ({ code, type, key }) => {
                    let history = null;
                    if (type === 'stock') history = await fetchStockHistoryServer(code, days);
                    else history = await fetchFundHistoryServer(code, days);
                    return { key, code, type, history };
                })
            );
            fetched.push(...chunkResults);
        }

        const dbRecords = [];

        await Promise.all(fetched.map(async ({ key, history, type, code }) => {
            if (history && history.length > 0) {
                const storageKey = `hist:${type}:${code}`;
                await writeDoc(storageKey, { date: today, history });
                result[key] = { history, summary: calcStats(history) };

                // 将最新的一条记录（当天数据）加入待写入数组
                const lastItem = history[history.length - 1];
                if (lastItem && lastItem.date && lastItem.value) {
                    dbRecords.push({ code, type, price: lastItem.value, date: lastItem.date });
                }
            } else {
                result[key] = { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
            }
        }));

        if (dbRecords.length > 0) {
            await insertDailyPricesBatch(dbRecords);
        }
    }
    return NextResponse.json(result);
}
