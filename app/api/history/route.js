import { NextResponse } from 'next/server';
import { readDoc, writeDoc, getHistoryFromKV, insertDailyPricesBatch, addSystemLog } from '@/lib/storage';

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
    const mkt = prefix === 'sz' ? '0' : '1'; // sz为0，其他为1（sh等）
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
        console.warn(`[History] EastMoney stock ${code} failed:`, e.message);
    }
    return null;
}

async function fetchFundHistoryServer(code, days) {
    try {
        const probeRes = await fetchWithTimeout(
            `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=20&_=${Date.now()}`,
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
                    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=20&_=${Date.now()}`,
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
        console.error(`[History] Fund lsjz ${code} failed:`, e.message);
    }
    return null;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const type = searchParams.get('type');
    const days = parseInt(searchParams.get('days') || '250', 10);

    if (!code || !type) {
        return NextResponse.json({ error: 'Missing code or type' }, { status: 400 });
    }

    const storageKey = `hist:${type}:${code}`;
    const today = todayStr();
    const entry = await readDoc(storageKey, null);

    if (entry && entry.date === today && Array.isArray(entry.history) && entry.history.length >= days * 0.7) {
        await addSystemLog('INFO', 'History', `KV Cache Hit: ${code} (${type})`);
        return NextResponse.json({
            history: entry.history,
            summary: calcStats(entry.history)
        });
    }

    let history = null;
    let fetchedFromEastMoney = false;

    // 优先从 KV 获取 (股票和基金通用)
    history = await getHistoryFromKV(code, type, days);

    if (history && history.length >= days * 0.7) {
        await addSystemLog('INFO', 'History', `KV Cache Hit: ${code} (${type}), returned ${history.length} points`);
    } else {
        if (type === 'stock') {
            history = await fetchStockHistoryServer(code, days);
        } else if (type === 'fund') {
            history = await fetchFundHistoryServer(code, days);
        }
        fetchedFromEastMoney = true;
        await addSystemLog('INFO', 'History', `External Fetch: ${code} (${type}) because KV had insufficient data`);
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } });
    }

    await writeDoc(storageKey, { date: today, history });

    if (fetchedFromEastMoney && history.length > 0) {
        // 请求回来的数据全量入库 (不再区分股票或基金)
        const records = history.map(h => ({ code, type, price: h.value, date: h.date }));
        await insertDailyPricesBatch(records);
    }

    return NextResponse.json({
        history,
        summary: calcStats(history)
    });
}
