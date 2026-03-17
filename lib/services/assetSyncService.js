/**
 * lib/services/assetSyncService.js
 * 
 * 资产同步 Service 层 (L3 Logic)
 * 
 * 职责：
 * 1. 统筹资产名称 (syncNamesBulk) 与历史数据 (syncHistoryBulk) 的多级同步逻辑。
 * 2. 封装外部 API 交互 (fetch) 与 D1 存储操作。
 * 3. 作为唯一的事实来源供 API 路由、Cron 任务及后台机制调用。
 */

import { getBulkHistory, insertDailyPricesBatch } from '@/lib/storage/historyRepo'
import { getAssetNames, saveAssetNames } from '@/lib/storage/nameRepo'
import { memoryCache } from '@/lib/storage/memoryCache'
import { calculateStats, fetchWithRetry, getBeijingDate, getBeijingTodayStr } from '@/lib/utils'
import {
    EASTMONEY_HEADERS,
    EASTMONEY_FUND_HEADERS,
    EASTMONEY_FUND_HTML_HEADERS,
    TENCENT_HEADERS
} from '@/lib/constants/headers'
import { parseStockCode, toSecid } from '@/lib/utils/stockCode'

/**
 * =============================
 * 辅助工具函数 (Internal)
 * =============================
 */

function daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    const diffTime = date2 - date1;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function parseTrends2Response(json) {
    const d = json?.data
    if (!d?.trends?.length) return null

    const prevClose = parseFloat(d.preClose) || parseFloat(d.prePrice) || 0
    const points = d.trends
        .map(line => {
            const parts = line.split(',')
            const timePart = parts[0].includes(' ') ? parts[0].split(' ')[1] : parts[0]
            const val = parseFloat(parts[2])
            return { time: timePart, value: isNaN(val) ? 0 : val }
        })
        .filter(p => p.value > 0)

    return points.length ? { points, prevClose } : null
}

function isDbDataFresh(dbData, nowMs, maxAgeMs = 60000) {
    if (!dbData?.points?.length) return false
    const isToday = dbData.points[0]?.time?.includes(':') && !dbData.points[0]?.time?.includes('-')
    if (!isToday) return true
    const updatedAt = dbData.updated_at ? new Date(dbData.updated_at).getTime() : 0
    return nowMs - updatedAt < maxAgeMs
}

function isInvalidName(name) {
    if (!name || typeof name !== 'string') return true;
    const clean = name.trim();
    if (clean.length === 0) return true;
    const ERROR_PATTERNS = ['页面未找到', '404', 'Bad Gateway', 'Service Unavailable', 'Cloudflare', 'Internal Server Error', '东方财富网'];
    if (ERROR_PATTERNS.some(p => clean.includes(p)) && clean.length < 20) return true;
    if (/^\d{6}$/.test(clean)) return true;
    let badChars = 0;
    for (let i = 0; i < clean.length; i++) {
        const code = clean.charCodeAt(i);
        if (code === 0xFFFD) return true;
        if (code < 0x20 && code !== 0x0A && code !== 0x0D) badChars++;
        if (code >= 0xE000 && code <= 0xF8FF) badChars++;
    }
    return (badChars / clean.length) > 0.3;
}

/**
 * =============================
 * 外部 API 抓取 (EastMoney)
 * =============================
 */

async function fetchStockName(code) {
    const secid = toSecid(code);
    if (!secid) return null;
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f58`;
        const res = await fetchWithRetry(url, { headers: EASTMONEY_HEADERS });
        if (res.ok) {
            const json = await res.json();
            if (json.data?.f58) return json.data.f58;
        }
    } catch (e) {
        console.error(`[fetchStockName] Error fetching ${code}:`, e.message);
    }
    return null;
}

async function fetchFundName(code) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i);
    const clean = match ? match[2] : code;
    try {
        const url = `https://qt.gtimg.cn/q=s_jj${clean}`;
        const res = await fetchWithRetry(url, { headers: TENCENT_HEADERS });
        if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const text = new TextDecoder('gbk').decode(arrayBuffer);
            const parts = text.split('~');
            if (parts.length > 2 && parts[1]) return parts[1].trim();
        }
    } catch (e) {
        console.error(`[fetchFundName:Tencent] Error for ${code}:`, e.message);
    }

    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=1&_=${Date.now()}`;
        const res = await fetchWithRetry(url, { headers: EASTMONEY_FUND_HEADERS });
        if (res.ok) {
            const data = await res.json();
            if (data.Expansion) return data.Expansion;
        }
    } catch (e) {
        console.error(`[fetchFundName:EastMoney] Error for ${code}:`, e.message);
    }
    return null;
}

/**
 * =============================
 * 核心业务逻辑 (Exported Services)
 * =============================
 */

const CACHE_KEY_PREFIX = 'api_intraday_';
const CACHE_TTL = 30 * 1000;

export async function fetchSingleIntraday(code, preFetchedDbData = null, externalAbortSignal = null) {
    const cached = memoryCache.get(CACHE_KEY_PREFIX + code)
    if (cached) return cached

    const { getIntraday } = await import('@/lib/storage/intradayRepo')
    const dbData = preFetchedDbData ?? await getIntraday(code, getBeijingTodayStr(), true)
    if (isDbDataFresh(dbData, Date.now())) return dbData

    const parsed = parseStockCode(code);
    if (!parsed) return dbData;
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${parsed.market}.${parsed.clean}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`

    let res
    try {
        res = await fetchWithRetry(url, { headers: EASTMONEY_HEADERS }, 0, externalAbortSignal)
    } catch (e) {
        console.error(`[Intraday] Fetch failed for ${code}:`, e.message)
        return dbData
    }

    if (!res.ok) return dbData

    const trendsData = parseTrends2Response(await res.json())
    if (!trendsData) return dbData

    const { points, prevClose } = trendsData
    const lastPrice = points[points.length - 1].value
    const effectivePrevClose = prevClose || points[0].value
    const result = {
        code,
        price: lastPrice,
        changePercent: effectivePrevClose > 0 ? ((lastPrice / effectivePrevClose - 1) * 100) : 0,
        prevClose: effectivePrevClose,
        points
    }

    memoryCache.set(CACHE_KEY_PREFIX + code, result, CACHE_TTL)
    return result
}

export async function syncIntradayBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const today = getBeijingTodayStr();
    const result = {};

    const toFetchFromPersist = [];
    for (const item of items) {
        const cached = memoryCache.get(CACHE_KEY_PREFIX + item.code);
        if (cached) {
            result[item.code] = cached;
        } else {
            toFetchFromPersist.push(item);
        }
    }

    if (toFetchFromPersist.length > 0) {
        const { getBulkIntraday, saveIntradayBatch } = await import('@/lib/storage/intradayRepo')
        const dbDataMap = await getBulkIntraday(toFetchFromPersist, today);
        const externalFetchList = [];
        const now = Date.now();

        for (const item of toFetchFromPersist) {
            const dbData = dbDataMap[item.code];
            const stalenessThreshold = allowExternal ? 60000 : 300000;

            if (isDbDataFresh(dbData, now, stalenessThreshold)) {
                result[item.code] = dbData;
                memoryCache.set(CACHE_KEY_PREFIX + item.code, dbData, CACHE_TTL);
                continue;
            }

            if (allowExternal) {
                externalFetchList.push(item);
            } else if (dbData) {
                result[item.code] = dbData;
                memoryCache.set(CACHE_KEY_PREFIX + item.code, dbData, CACHE_TTL);
            }
        }

        if (externalFetchList.length > 0 && allowExternal) {
            const { default: pLimit } = await import('p-limit')
            const limit = pLimit(5);
            const safeFetchList = externalFetchList.slice(0, 15);
            const globalController = new AbortController();
            const globalTimeout = setTimeout(() => globalController.abort(), 25000);

            const fetchPromises = safeFetchList.map(item =>
                limit(async () => {
                    const data = await fetchSingleIntraday(item.code, dbDataMap[item.code], globalController.signal);
                    return data ? { code: item.code, data } : null;
                })
            );

            try {
                const fetchedResults = await Promise.all(fetchPromises);
                clearTimeout(globalTimeout);
                const recordsToSave = [];

                for (const res of fetchedResults) {
                    if (res?.data) {
                        result[res.code] = res.data;
                        recordsToSave.push({ code: res.code, date: today, data: res.data });
                    }
                }

                if (recordsToSave.length > 0) {
                    await saveIntradayBatch(recordsToSave);
                }
            } catch (err) {
                console.error(`[Intraday Bulk] Global error:`, err.message);
            }
        }
    }

    return result;
}

export async function syncHistoryBulk(items, days = 250, allowExternal = false, env = null) {
    if (!items?.length) return {}
    const dbHistoryMap = await getBulkHistory(items, days)
    const result = {}
    const today = getBeijingTodayStr()

    for (const item of items) {
        const key = `${item.type}:${item.code}`
        let dbHistory = dbHistoryMap[key] || []

        // [Fix] 如果 D1 没数据且允许外部抓取，则立即执行 fetch 并写入 D1
        if (dbHistory.length === 0 && allowExternal) {
            try {
                const { fetchStockHistory, fetchFundHistory } = await import('./historyFetcher')
                const { insertDailyPricesBatch } = await import('../storage/historyRepo')

                const fetcher = item.type === 'fund' ? fetchFundHistory : fetchStockHistory
                const externalData = await fetcher(item.code, days)

                if (externalData && externalData.length > 0) {
                    // 适配 insertDailyPricesBatch 所需的 records 格式
                    const records = externalData.map(d => ({
                        code: item.code,
                        type: item.type,
                        price: d.value,
                        date: d.date
                    }))
                    await insertDailyPricesBatch(records)
                    dbHistory = externalData
                }
            } catch (e) {
                console.error(`[SyncBulk] External fetch failed for ${key}:`, e.message)
            }
        }

        if (dbHistory.length === 0) {
            result[key] = {
                status: 'syncing',
                history: [],
                summary: { perf5d: 0, perf22d: 0, perf250d: 0 }
            }
            continue
        }

        const latestDate = dbHistory[dbHistory.length - 1].date
        const gap = daysBetween(latestDate, today)

        result[key] = {
            status: gap > 0 ? 'updating' : 'ready',
            history: dbHistory,
            summary: calculateStats(dbHistory)
        }
    }
    return result
}

export async function syncNamesBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const CACHE_KEY_PREFIX = 'api_name_';
    const CACHE_TTL = 3600 * 1000;
    const result = {};
    const missingInMem = [];

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        const cached = memoryCache.get(CACHE_KEY_PREFIX + key);
        if (cached && !isInvalidName(cached)) {
            result[key] = cached;
        } else {
            missingInMem.push(item);
        }
    }

    if (missingInMem.length === 0) return result;

    const d1Result = await getAssetNames(missingInMem);
    const toFetch = [];

    for (const item of missingInMem) {
        const key = `${item.type}:${item.code}`;
        const name = d1Result[key];
        if (name && !isInvalidName(name)) {
            result[key] = name;
            memoryCache.set(CACHE_KEY_PREFIX + key, name, CACHE_TTL);
        } else {
            toFetch.push(item);
        }
    }

    if (toFetch.length > 0 && allowExternal) {
        const fetched = [];
        const CHUNK_SIZE = 5;
        const NAME_SUBREQ_BUDGET = 20;
        let subreqCount = 0;

        for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
            if (subreqCount >= NAME_SUBREQ_BUDGET) {
                console.warn(`[syncNamesBulk] Budget exceeded (${subreqCount}/${NAME_SUBREQ_BUDGET}). Skipping ${toFetch.length - i} names.`);
                break;
            }
            const chunk = toFetch.slice(i, i + CHUNK_SIZE);
            const chunkFetched = await Promise.all(chunk.map(async (item) => {
                const key = `${item.type}:${item.code}`;
                let name = (item.type === 'fund') ? await fetchFundName(item.code) : await fetchStockName(item.code);
                return { key, name };
            }));
            fetched.push(...chunkFetched);
            subreqCount += chunk.length;
        }

        let newNames = {};
        for (const { key, name } of fetched) {
            if (name) {
                result[key] = name;
                newNames[key] = name;
                memoryCache.set(CACHE_KEY_PREFIX + key, name, CACHE_TTL);
            }
        }
        if (Object.keys(newNames).length > 0) {
            await saveAssetNames(newNames);
        }
    }

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key]) result[key] = item.code;
    }

    return result;
}
