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
import { calculateStats } from '@/lib/utils'

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
};

/**
 * =============================
 * 辅助工具函数 (Internal)
 * =============================
 */

function bjDate() {
    return new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
    )
}

function todayStr() {
    return bjDate().toISOString().slice(0, 10)
}

function daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    const diffTime = date2 - date1;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    let clean = code;
    let market = '1';
    if (match) {
        const prefix = match[1].toLowerCase();
        clean = match[2];
        if (prefix === 'sz') market = '0';
    }
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f58`;
        const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
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
        const res = await fetchWithTimeout(url, { headers: BASE_HEADERS });
        if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const text = new TextDecoder('gbk').decode(arrayBuffer);
            const parts = text.split('~');
            if (parts.length > 2 && parts[1]) return parts[1].trim();
        }
    } catch (e) { }

    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=1&_=${Date.now()}`;
        const res = await fetchWithTimeout(url, { headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' } });
        if (res.ok) {
            const data = await res.json();
            if (data.Expansion) return data.Expansion;
        }
    } catch (e) { }
    return null;
}

/**
 * =============================
 * 核心业务逻辑 (Exported Services)
 * =============================
 */

export async function syncHistoryBulk(items, days = 250, allowExternal = false) {
    if (!items?.length) return {}
    const dbHistoryMap = await getBulkHistory(items, days)
    const result = {}
    const today = todayStr()

    for (const item of items) {
        const key = `${item.type}:${item.code}`
        const dbHistory = dbHistoryMap[key] || []

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
        const CHUNK_SIZE = 10;
        for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
            const chunk = toFetch.slice(i, i + CHUNK_SIZE);
            const chunkFetched = await Promise.all(chunk.map(async (item) => {
                const key = `${item.type}:${item.code}`;
                let name = (item.type === 'fund') ? await fetchFundName(item.code) : await fetchStockName(item.code);
                return { key, name };
            }));
            fetched.push(...chunkFetched);
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
