import { NextResponse } from 'next/server';
import { readDoc, writeDoc, insertDailyPricesBatch, getBulkHistoryFromDB, getHistoryFromDB, addSystemLog } from '@/lib/storage';

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
            console.warn(`[Bulk] Sina stock ${code} failed:`, e.message);
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
        // 每 3 个分页一组串行执行，减少瞬时并发
        const PAGE_BATCH_SIZE = 3;
        for (let i = 0; i < pagePromises.length; i += PAGE_BATCH_SIZE) {
            const batch = pagePromises.slice(i, i + PAGE_BATCH_SIZE);
            const batchRes = await Promise.all(batch);
            pageResults.push(...batchRes);
            // 批次间微小停顿
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
        console.error(`[Bulk] Fund lsjz ${code} failed:`, e.message);
    }
    return null;
}

export async function POST(request) {
    try {
        const { items, days = 250, allowExternal = false } = await request.json();
        if (!Array.isArray(items) || items.length === 0) return NextResponse.json({});

        // 初始化
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            await env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS asset_history (
                    code TEXT NOT NULL,
                    type TEXT NOT NULL,
                    record_date TEXT NOT NULL,
                    price REAL NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(code, type, record_date)
                );
            `).run();
        }

        const result = {};
        const toFetchExternally = [];

        // 1. 并发从 D1 获取 DB 数据
        const dbPromises = items.map(async (item) => {
            const dbHistory = await getHistoryFromDB(item.code, item.type, days);
            const key = `${item.type}:${item.code}`;

            if (dbHistory && dbHistory.length > 0) {
                // 判断 D1 里的数据是否过期 (比如最后一条数据的日期是不是今天/昨天)
                // 为简便起见，如果 D1 里有足量数据或最近的数据，我们直接使用
                const latestDateStr = dbHistory[0].date;
                const latestDate = new Date(latestDateStr);
                const today = new Date();
                today.setHours(today.getHours() + 8); // Asia/Shanghai
                const timeDiff = today.getTime() - latestDate.getTime();
                const daysDiff = timeDiff / (1000 * 3600 * 24);

                // 如果 allowExternal=false，我们强制使用 DB 数据（不进行过期判断）
                if (!allowExternal || daysDiff < 2) {
                    const sortedHistory = [...dbHistory].reverse();
                    result[key] = {
                        history: sortedHistory,
                        summary: calcStats(sortedHistory)
                    };
                    return;
                }
            }
            if (allowExternal) {
                toFetchExternally.push(item);
            }
        });

        await Promise.all(dbPromises);

        // 2. 对于 D1 中没有足够数据或数据过期的，尝试从外部 API 获取 (如果 allowExternal 为 true)
        if (toFetchExternally.length > 0) {
            const CHUNK_SIZE = 4;
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
                if (i + CHUNK_SIZE < toFetchExternally.length) await new Promise(r => setTimeout(r, 400));
            }

            const dbRecords = [];
            for (const item of fetchedList) {
                const key = `${item.type}:${item.code}`;
                if (item.history && item.history.length > 0) {
                    await writeDoc(`hist:${item.type}:${item.code}`, { date: new Date().toISOString(), history: item.history });
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
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
