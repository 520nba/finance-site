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
    TENCENT_HEADERS
} from '@/lib/constants/headers'
import { parseStockCode, toSecid } from '@/lib/utils/stockCode'
import pLimit from 'p-limit'
import { fetchStockHistory, fetchFundHistory } from './historyFetcher'
import { getBulkIntraday, saveIntradayBatch } from '@/lib/storage/intradayRepo'

/**
 * =============================
 * 辅助工具函数 (Internal)
 * =============================
 */



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
            const limit = pLimit(5);
            const safeFetchList = externalFetchList.slice(0, 15);

            // 使用 Promise.race 实现全局超时，而非 AbortSignal，防止排队中的任务被误杀
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Global intraday timeout')), 25000)
            );

            const fetchPromises = safeFetchList.map(item =>
                limit(async () => {
                    const data = await fetchSingleIntraday(item.code, dbDataMap[item.code]);
                    return { code: item.code, data };
                })
            );

            try {
                // 并发执行并在 25 秒后强制截断执行窗口
                const settledResults = await Promise.race([
                    Promise.allSettled(fetchPromises),
                    timeoutPromise
                ]);

                const recordsToSave = [];
                for (const res of settledResults) {
                    if (res.status === 'fulfilled' && res.value?.data) {
                        const { code, data } = res.value;
                        result[code] = data;
                        recordsToSave.push({ code, date: today, data });
                    }
                }

                if (recordsToSave.length > 0) {
                    await saveIntradayBatch(recordsToSave);
                }
            } catch (err) {
                console.error(`[Intraday Bulk] Process interrupted:`, err.message);
                // 超时时，本次通过外部接口抓取的所有结果将被丢弃，系统将在下一次请求时重新尝试。
            }
        }
    }

    return result;
}

export async function syncHistoryBulk(items, days = 250, allowExternal = false, env = null) {
    if (!items?.length) return {};

    const today = getBeijingTodayStr();

    // 1. 并发执行：抓取外部数据 + 读取 D1 现有存量
    const [externalMap, dbHistoryMap] = await Promise.all([
        allowExternal ? fetchExternalConcurrent(items, days) : Promise.resolve({}),
        getBulkHistory(items, days, env)
    ]);

    // 2. 筛选需要写入 D1 的记录
    const recordsToWrite = [];
    const result = {};

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        const externalData = externalMap[key];
        const dbHistory = dbHistoryMap[key] || [];

        // 最终返回给前端的数据：优先用新抓的，抓不到用库里的
        const finalHistory = externalData || dbHistory;

        // 判定是否需要写入 D1
        if (externalData?.length > 0) {
            const dbLatestDate = dbHistory.length > 0 ? dbHistory[dbHistory.length - 1].date : null;
            const externalLatestDate = externalData[externalData.length - 1].date;

            // 写入条件：数据库为空 OR 外部有更新日期
            if (!dbLatestDate || externalLatestDate > dbLatestDate) {
                // ✅ 优化为增量写入：只写数据库中不存在的新记录
                const newRecords = dbLatestDate
                    ? externalData.filter(d => d.date > dbLatestDate)
                    : externalData;

                recordsToWrite.push(...newRecords.map(d => ({
                    code: item.code,
                    type: item.type,
                    price: d.value,
                    date: d.date
                })));
            }
        }

        // 3. 组装单体返回结果，细化状态以供前端决策
        result[key] = {
            status: finalHistory.length === 0 ? 'syncing'
                : externalData ? 'fresh'
                    : 'stale',
            history: finalHistory,
            summary: calculateStats(finalHistory)
        };
    }

    // 4. 执行批量原子写入
    if (recordsToWrite.length > 0) {
        try {
            await insertDailyPricesBatch(recordsToWrite, env);
            console.log(`[SyncBulk] Atomic batch write completed: ${recordsToWrite.length} records.`);
        } catch (e) {
            console.error(`[SyncBulk] Batch write failed:`, e.message);
        }
    }

    return result;
}

/**
 * 内部辅助：并发抓取外部历史数据
 */
async function fetchExternalConcurrent(items, days) {
    const limit = pLimit(3); // 限制并发，保护外部 API
    const results = {};

    await Promise.allSettled(items.map(item =>
        limit(async () => {
            try {
                const data = item.type === 'fund'
                    ? await fetchFundHistory(item.code, days)
                    : await fetchStockHistory(item.code, days);

                if (data?.length > 0) {
                    results[`${item.type}:${item.code}`] = data;
                }
            } catch (e) {
                console.error(`[fetchExternal] ${item.type}:${item.code} failed:`, e.message);
            }
        })
    ));

    return results;
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
        const limit = pLimit(5); // 并发控制：直接锁定 5 个出口，替代虚假的计数预算

        const settled = await Promise.allSettled(
            toFetch.map(item => limit(async () => {
                const key = `${item.type}:${item.code}`;
                const name = (item.type === 'fund')
                    ? await fetchFundName(item.code)
                    : await fetchStockName(item.code);
                return { key, name };
            }))
        );

        const newNamesToSave = {};
        for (const res of settled) {
            if (res.status === 'fulfilled' && res.value.name) {
                const { key, name } = res.value;
                result[key] = name;
                newNamesToSave[key] = name;
                memoryCache.set(CACHE_KEY_PREFIX + key, name, CACHE_TTL);
            }
        }

        if (Object.keys(newNamesToSave).length > 0) {
            await saveAssetNames(newNamesToSave);
        }
    }

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        if (!result[key]) result[key] = item.code;
    }

    return result;
}
