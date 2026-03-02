import { readDoc, writeDoc, getHistoryFromDB, insertDailyPricesBatch } from '@/lib/storage';

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
            console.warn(`[History] Sina stock ${code} failed:`, e.message);
        }
    }
    return null;
}

async function fetchFundHistoryServer(code, days) {
    // 仅抓取东财 lsjz（场外开放式基金历史净值）
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
        const pageResults = [];
        const PAGE_BATCH_SIZE = 3;
        for (let i = 0; i < pagePromises.length; i += PAGE_BATCH_SIZE) {
            const batch = pagePromises.slice(i, i + PAGE_BATCH_SIZE);
            const batchRes = await Promise.all(batch);
            pageResults.push(...batchRes);
            if (i + PAGE_BATCH_SIZE < pagePromises.length) {
                await new Promise(r => setTimeout(r, 50));
            }
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
        return NextResponse.json({
            history: entry.history,
            summary: calcStats(entry.history)
        });
    }

    let history = null;
    let fetchedFromEastMoney = false;

    // 优先从 DB 获取 (股票和基金通用)
    history = await getHistoryFromDB(code, type, days);

    if (!history || history.length < days * 0.7) {
        if (type === 'stock') {
            history = await fetchStockHistoryServer(code, days);
        } else if (type === 'fund') {
            history = await fetchFundHistoryServer(code, days);
        }
        fetchedFromEastMoney = true;
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
