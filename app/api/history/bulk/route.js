import { NextResponse } from 'next/server';
import { readDoc, writeDoc, insertDailyPricesBatch, getBulkHistoryFromKV, getHistoryFromKV, addSystemLog } from '@/lib/storage';

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// ── 外部数据获取（服务端直连）──────────────────────────────────────
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
};

function resolveMarket(code) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    let prefix = '';
    let clean = code;
    if (match) {
        prefix = match[1].toLowerCase();
        clean = match[2];
    }
    return { prefix, clean };
}

function calcStats(history) {
    if (!history || history.length < 2) return { perf5d: 0, perf22d: 0, perf250d: 0 };
    const getPerf = (days) => {
        const data = history.slice(-(days + 1));
        if (data.length < 2 || !data[0].value || data[0].value === 0) return 0;
        const perf = ((data[data.length - 1].value / data[0].value) - 1) * 100;
        return isNaN(perf) || !isFinite(perf) ? 0 : perf;
    };
    return {
        perf5d: getPerf(5),
        perf22d: getPerf(22),
        perf250d: getPerf(250)
    };
}

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

async function fetchStockHistoryServer(code, days) {
    const { prefix, clean } = resolveMarket(code);
    const mkt = prefix === 'sz' ? '0' : '1';
    try {
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 5}`;
        const res = await fetchWithTimeout(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://quote.eastmoney.com/' } }, 4000);
        if (res.ok) {
            const d = await res.json();
            if (d.data && d.data.klines) {
                const data = d.data.klines.map(line => {
                    const parts = line.split(',');
                    return { date: parts[0], value: parseFloat(parts[1]) };
                }).filter(i => !isNaN(i.value));
                if (data.length > 0) return data.slice(-days);
            }
        }
    } catch (e) {
        console.warn(`[Bulk] EastMoney stock ${code} failed:`, e.message);
    }
    return null;
}

async function fetchFundHistoryServer(code, days) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i);
    const clean = match ? match[2] : code;
    try {
        const probeRes = await fetchWithTimeout(
            `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=20&_=${Date.now()}`,
            { headers: { ...BASE_HEADERS, 'Referer': `http://fundf10.eastmoney.com/` } },
            4000
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
                () => fetchWithTimeout(
                    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=${page}&pageSize=20&_=${Date.now()}`,
                    { headers: { ...BASE_HEADERS, 'Referer': `http://fundf10.eastmoney.com/` } },
                    3000
                ).then(r => r.ok ? r.json() : null).catch(() => null)
            );
        }

        const pageResults = [];
        const PAGE_BATCH_SIZE = 6;
        for (let i = 0; i < pagePromises.length; i += PAGE_BATCH_SIZE) {
            const batch = pagePromises.slice(i, i + PAGE_BATCH_SIZE);
            const batchRes = await Promise.all(batch.map(fn => fn()));
            pageResults.push(...batchRes);
        }

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

export async function syncHistoryBulk(items, days = 250, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const result = {};
    const toFetchExternally = [];

    // 1. 并发从 KV 缓存获取历史数据 (使用 Batch)
    const dbHistoryMap = await getBulkHistoryFromKV(items, days);

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        const dbHistory = dbHistoryMap[key];

        if (dbHistory && dbHistory.length > 0) {
            // 实际上 getBulkHistoryFromKV 返回的是 reverse 后的结果，即正序（最早到最新）。
            const latestDateStr = dbHistory[dbHistory.length - 1].date;
            const latestDate = new Date(latestDateStr);
            const today = new Date();
            today.setHours(today.getHours() + 8); // Asia/Shanghai
            const timeDiff = today.getTime() - latestDate.getTime();
            const daysDiff = timeDiff / (1000 * 3600 * 24);

            // 核心隔离逻辑：如果不允许外部访问，直接返回 KV 缓存内容（哪怕是旧的）
            // 如果允许外部访问且数据足够“新鲜”（小于 2 天），也直接返回缓存
            if (!allowExternal || daysDiff < 2) {
                result[key] = {
                    history: dbHistory,
                    summary: calcStats(dbHistory)
                };
                continue;
            }
        }
        if (allowExternal) {
            toFetchExternally.push(item);
        }
    }

    // 2. 对于 KV 缓存中没有足够数据或数据过期的，尝试从外部 API 获取 (如果 allowExternal 为 true)
    if (toFetchExternally.length > 0) {
        const CHUNK_SIZE = 8;
        const fetchedList = [];
        for (let i = 0; i < toFetchExternally.length; i += CHUNK_SIZE) {
            const chunk = toFetchExternally.slice(i, i + CHUNK_SIZE);
            const chunkRes = await Promise.all(chunk.map(async (it) => {
                let history = null;
                if (it.type === 'stock') history = await fetchStockHistoryServer(it.code, days);
                else history = await fetchFundHistoryServer(it.code, days);
                return { ...it, history, fetchedFromAPI: true };
            }));
            fetchedList.push(...chunkRes);
            if (i + CHUNK_SIZE < toFetchExternally.length) await new Promise(r => setTimeout(r, 100));
        }

        const dbRecords = [];
        for (const item of fetchedList) {
            const key = `${item.type}:${item.code}`;
            if (item.history && item.history.length > 0) {
                result[key] = { history: item.history, summary: calcStats(item.history) };
                for (const h of item.history) {
                    dbRecords.push({ code: item.code, type: item.type, price: h.value, date: h.date });
                }
            } else {
                result[key] = { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
            }
        }

        if (dbRecords.length > 0) {
            await insertDailyPricesBatch(dbRecords);
        }
    }
    return result;
}

export async function POST(request) {
    try {
        const { items, days = 250, allowExternal = false } = await request.json();
        const result = await syncHistoryBulk(items, days, allowExternal);
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
