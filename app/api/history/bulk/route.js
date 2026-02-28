import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const CACHE_PATH = path.join(process.cwd(), 'data', 'history_cache.json');

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

async function readCache() {
    try {
        const raw = await fs.readFile(CACHE_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

async function writeCache(cache) {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
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
    // 识别场内基金 (ETF/LOF) 典型号段
    const isListed = code.startsWith('5') || code.startsWith('15') || code.startsWith('16') || code.startsWith('58');

    const getSina = async () => {
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
        return null;
    };

    const getEastMoney = async () => {
        try {
            const probeRes = await fetch(
                `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=20&_=${Date.now()}`,
                { headers: { ...BASE_HEADERS, 'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html` } }
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
                        { headers: { ...BASE_HEADERS, 'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html` } }
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
    };

    if (isListed) {
        const d = await getSina();
        if (d) return d;
        return await getEastMoney();
    } else {
        const d = await getEastMoney();
        if (d) return d;
        return await getSina();
    }
}

/**
 * POST /api/history/bulk
 * Body: { items: [{code, type}], days?: number }
 * Response: { "stock:600036": [...], "fund:012831": [...], ... }
 */
export async function POST(request) {
    const { items, days = 250 } = await request.json();
    if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({});
    }

    const today = todayStr();
    const cache = await readCache();
    const result = {};
    const toFetch = [];

    // 分离缓存命中 vs 需要爬取
    for (const { code, type } of items) {
        const key = `${type}:${code}`;
        const entry = cache[key];
        if (entry && entry.date === today && Array.isArray(entry.history) && entry.history.length >= days * 0.7) {
            result[key] = {
                history: entry.history,
                summary: calcStats(entry.history)
            };
        } else {
            toFetch.push({ code, type, key });
        }
    }

    if (toFetch.length > 0) {
        console.log(`[History/Bulk] Cache miss for ${toFetch.length} assets, fetching…`);

        // 全量并发爬取缓存未命中的资产
        const fetched = await Promise.all(
            toFetch.map(async ({ code, type, key }) => {
                let history = null;
                try {
                    if (type === 'stock') {
                        history = await fetchStockHistoryServer(code, days);
                    } else {
                        history = await fetchFundHistoryServer(code, days);
                    }
                } catch (e) {
                    console.error(`[Bulk] fetch ${key} failed:`, e.message);
                }
                return { key, code, type, history };
            })
        );

        // 写回缓存，汇入结果
        let cacheUpdated = false;
        for (const { key, history } of fetched) {
            if (history && history.length > 0) {
                const stats = calcStats(history);
                cache[key] = { date: today, history };
                result[key] = { history, summary: stats };
                cacheUpdated = true;
            } else {
                result[key] = { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
            }
        }

        if (cacheUpdated) {
            try {
                await writeCache(cache);
            } catch (e) {
                console.error('[Bulk] Write cache failed:', e.message);
            }
        }
    }

    console.log(`[History/Bulk] Served ${items.length} items (${items.length - toFetch.length} cached, ${toFetch.length} fresh)`);
    return NextResponse.json(result);
}
