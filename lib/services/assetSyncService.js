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
import { toSecid } from '@/lib/utils/stockCode'
import pLimit from 'p-limit'
import { fetchStockHistory, fetchFundHistory } from './historyFetcher'
import { fetchIntradaySnapshot } from './intradayFetcher'
import { getBulkIntraday, getIntraday, upsertIntradaySnapshot } from '@/lib/storage/intradayRepo'

/**
 * =============================
 * 辅助工具函数 (Internal)
 * =============================
 */



function isDbDataFresh(dbData, targetDate, nowMs, maxAgeMs = 60000) {
    if (!dbData?.points?.length) return false
    // 漏洞修复：直接比对 record_date 字段，而非靠 time 格式推断，适配周末/非交易日
    if (dbData.record_date && dbData.record_date !== targetDate) return false
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
        const params = new URLSearchParams({ secid, fields: 'f58' });
        const url = `https://push2.eastmoney.com/api/qt/stock/get?${params}`;
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

const INTRADAY_CACHE_PREFIX = 'api_intraday_';
const INTRADAY_CACHE_TTL = 30 * 1000;
const NAME_CACHE_PREFIX = 'api_name_';
const NAME_CACHE_TTL = 3600 * 1000;

// ── 分时抓取健康上报（节流：5 分钟最多一条，避免 27 只票刷屏）────────────────
const HEALTH_REPORT_INTERVAL = 5 * 60 * 1000;
let _intradayHealthReportAt = 0;

async function _reportIntradayHealth(isSuccess, detail, env) {
    const now = Date.now();
    if (now - _intradayHealthReportAt < HEALTH_REPORT_INTERVAL) return;
    _intradayHealthReportAt = now;
    try {
        const { updateApiHealth } = await import('@/lib/storage/healthRepo');
        await updateApiHealth('Intra: Snapshot (App)', {
            status: isSuccess ? 'healthy' : 'down',
            avgLatency: 0,
            errorMsg: detail ? String(detail).slice(0, 200) : '',
            isSuccess
        }, env);
    } catch (e) {
        console.error('[Intraday] health report failed:', e.message);
    }
}

/**
 * 抓取单只股票的分时快照（多源回退：东财 → 腾讯）
 *
 * @param {string} code
 * @param {object|null} preFetchedDbData 已经读到的库内数据，避免重复查询
 * @param {AbortSignal|null} externalAbortSignal
 * @param {object|null} env  Worker 绑定。**Cron 路径必须传**，否则 getD1Storage()
 *                          在无请求上下文时抛 D1_BINDING_MISSING。
 * @returns {Promise<object|null>} 含 points / prevClose / source 的快照
 */
export async function fetchSingleIntraday(code, preFetchedDbData = null, externalAbortSignal = null, env = null) {
    const cached = memoryCache.get(INTRADAY_CACHE_PREFIX + code)
    if (cached) return cached

    const today = getBeijingTodayStr();
    const dbData = preFetchedDbData ?? await getIntraday(code, today, true, env)
    if (isDbDataFresh(dbData, today, Date.now(), INTRADAY_CACHE_TTL)) return dbData

    const { data, errors } = await fetchIntradaySnapshot(code, externalAbortSignal, today)

    if (!data) {
        const detail = `${code}: ${errors.join(' | ')}`
        console.error(`[Intraday] All sources failed → ${detail}`)
        await _reportIntradayHealth(false, detail, env)
        // 全源失败：仅把库内数据作为**读**兜底返回，并打上 source='db'，
        // 调用方据此拒绝把它当成新数据写回（避免曲线假装更新）
        return dbData ? { ...dbData, source: 'db' } : null
    }

    const lastPrice = data.points[data.points.length - 1].value
    const effectivePrevClose = data.prevClose || data.points[0].value
    const result = {
        code,
        price: lastPrice,
        changePercent: effectivePrevClose > 0 ? ((lastPrice / effectivePrevClose - 1) * 100) : 0,
        prevClose: effectivePrevClose,
        points: data.points,
        source: data.source,
        date: data.date || today
    }

    memoryCache.set(INTRADAY_CACHE_PREFIX + code, result, INTRADAY_CACHE_TTL)
    await _reportIntradayHealth(true, `source=${data.source} points=${data.points.length}`, env)
    return result
}

export async function syncIntradayBulk(items, allowExternal = false, env = null) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const today = getBeijingTodayStr();
    const result = {};

    const toFetchFromPersist = [];
    for (const item of items) {
        const cached = memoryCache.get(INTRADAY_CACHE_PREFIX + item.code);
        if (cached) {
            result[item.code] = cached;
        } else {
            toFetchFromPersist.push(item);
        }
    }

    if (toFetchFromPersist.length > 0) {
        const dbDataMap = await getBulkIntraday(toFetchFromPersist, today, env);
        const externalFetchList = [];
        const now = Date.now();

        for (const item of toFetchFromPersist) {
            const dbData = dbDataMap[item.code];
            const stalenessThreshold = allowExternal ? 60000 : 300000;

            if (isDbDataFresh(dbData, today, now, stalenessThreshold)) {
                result[item.code] = dbData;
                memoryCache.set(INTRADAY_CACHE_PREFIX + item.code, dbData, INTRADAY_CACHE_TTL);
                continue;
            }

            if (allowExternal) {
                externalFetchList.push(item);
            } else if (dbData) {
                result[item.code] = dbData;
                memoryCache.set(INTRADAY_CACHE_PREFIX + item.code, dbData, INTRADAY_CACHE_TTL);
            }
        }

        if (externalFetchList.length > 0 && allowExternal) {
            const limit = pLimit(5);
            const safeFetchList = externalFetchList.slice(0, 15);

            const fetchPromises = safeFetchList.map(item =>
                limit(async () => {
                    const data = await fetchSingleIntraday(item.code, dbDataMap[item.code], null, env);
                    return { code: item.code, data };
                })
            );

            // 带截止时间的 allSettled：超时后仍收集已完成的结果，避免浪费成功的请求
            let settledResults;
            try {
                settledResults = await Promise.race([
                    Promise.allSettled(fetchPromises),
                    new Promise(resolve =>
                        setTimeout(() => resolve(null), 25000)
                    )
                ]);
            } catch (err) {
                console.error(`[Intraday Bulk] Race error:`, err.message);
            }

            // 超时时 settledResults === null，手动检查每个 promise 的当前状态
            if (!settledResults) {
                console.warn(`[Intraday Bulk] Timeout, collecting partial results...`);
                settledResults = await Promise.allSettled(
                    fetchPromises.map(p => Promise.race([p, Promise.resolve({ status: 'timeout' })]))
                );
            }

            const recordsToSave = [];
            for (const res of settledResults) {
                const val = res.status === 'fulfilled' ? res.value : null;
                if (val?.data) {
                    result[val.code] = val.data;
                    // 只有真正来自外部数据源的快照才落库；source='db' 的兜底数据
                    // 写回只会把 updated_at 刷成当前时间，制造"数据是新的"假象
                    if (val.data.source && val.data.source !== 'db') {
                        recordsToSave.push({ code: val.code, data: val.data });
                    }
                }
            }

            // 逐条 upsert：与当日已有 JSON 合并，保证曲线只增不减
            for (const rec of recordsToSave) {
                try {
                    await upsertIntradaySnapshot(rec.code, today, rec.data, env);
                } catch (e) {
                    console.error(`[Intraday Bulk] Save failed for ${rec.code}:`, e.message);
                }
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

    const result = {};
    const missingInMem = [];

    for (const item of items) {
        const key = `${item.type}:${item.code}`;
        const cached = memoryCache.get(NAME_CACHE_PREFIX + key);
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
            memoryCache.set(NAME_CACHE_PREFIX + key, name, NAME_CACHE_TTL);
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
                memoryCache.set(NAME_CACHE_PREFIX + key, name, NAME_CACHE_TTL);
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
