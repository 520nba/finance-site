import { NextResponse } from 'next/server';
import { getIntraday, saveIntraday, getBulkIntraday, saveIntradayBatch } from '@/lib/storage/intradayRepo';

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// 全局内存缓存，用于合并高频重复请求 (有效期 30 秒)
const INTRADAY_CACHE = new Map();
const CACHE_TTL = 30 * 1000;

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
};

function resolveMarket(code) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    let prefix = '';
    let clean = code;
    let market = '1';
    if (match) {
        prefix = match[1].toLowerCase();
        clean = match[2];
        if (prefix === 'sz') market = '0';
    }
    return { market, clean };
}

async function fetchSingleIntradayServer(code, forcePersist = false) {
    const { market, clean } = resolveMarket(code);
    const today = todayStr();
    const now = Date.now();

    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${market}.${clean}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;

        // 检查内存缓存 (30秒)：命中时只打 console，不写日志
        const cached = INTRADAY_CACHE.get(code);
        if (cached && (now - cached.timestamp < CACHE_TTL)) {
            console.log(`[Intraday] Memory Cache Hit: ${code}`);
            return cached.data;
        }

        // 2. 优先尝试从持久化层获取 (有效期 1 分钟)
        const dbData = await getIntraday(code, today, true); // 开启 fallbackToLatest
        if (dbData && dbData.points && dbData.points.length > 0) {
            // 如果是今天的数据，检查 1 分钟新鲜度
            const isToday = dbData.points[0]?.time?.includes(':') && !dbData.points[0]?.time?.includes('-');
            const updatedAt = dbData.updated_at ? new Date(dbData.updated_at).getTime() : 0;
            // D1 缓存命中：同样只打 console，避免每个 Hit 都写日志
            if (now - updatedAt < 60000 || !isToday) {
                if (isToday) {
                    console.log(`[Intraday] D1 Cache Hit: ${code} (Fresh)`);
                } else {
                    console.log(`[Intraday] D1 Cache Hit: ${code} (Non-trading day fallback)`);
                }
                return dbData;
            }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 增加到 15s

        let res;
        try {
            res = await fetch(url, { headers: BASE_HEADERS, signal: controller.signal });
        } catch (fetchError) {
            if (fetchError.name === 'AbortError') {
                // 第一次超时，尝试最后一次重试 (10s)
                const retryController = new AbortController();
                const retryTimeout = setTimeout(() => retryController.abort(), 10000);
                try {
                    res = await fetch(url, { headers: BASE_HEADERS, signal: retryController.signal });
                } catch (retryError) {
                    throw retryError;
                } finally {
                    clearTimeout(retryTimeout);
                }
            } else {
                throw fetchError;
            }
        } finally {
            clearTimeout(timeout);
        }

        if (!res || !res.ok) return dbData;
        const json = await res.json();
        const d = json.data;
        if (!d || !d.trends || !Array.isArray(d.trends) || d.trends.length === 0) {
            // 如果远程返回空（非交易日），则彻底信任并返回 D1 中的上一个交易日数据
            return dbData;
        }

        let points = [];
        let prePrice = parseFloat(d.preClose) || parseFloat(d.prePrice) || 0;

        points = d.trends.map(line => {
            const parts = line.split(',');
            const fullTime = parts[0];
            const timePart = fullTime.includes(' ') ? fullTime.split(' ')[1] : fullTime;
            // trends2 接口会直接返回真实的浮点数价格，无需像 trends 接口一样除以 100，完美适配 ETF (例如返回 3.341 而非 3341)
            const val = parseFloat(parts[2]);
            return {
                time: timePart,
                value: isNaN(val) ? 0 : val
            };
        }).filter(p => p.value > 0);

        if (points.length === 0) return null;

        const lastPrice = points[points.length - 1].value;
        const effectivePrevClose = prePrice || points[0].value;
        const changePercent = effectivePrevClose > 0 ? ((lastPrice / effectivePrevClose - 1) * 100) : 0;

        const result = {
            code,
            price: lastPrice,
            changePercent,
            prevClose: effectivePrevClose,
            points
        };

        INTRADAY_CACHE.set(code, { timestamp: now, data: result });
        console.log(`[Intraday] External Fetch: ${code}`);

        return result;
    } catch (e) {
        console.error(`[Intraday Bulk] Failed for ${code}:`, e.message);
        return null;
    }
}

export async function syncIntradayBulk(items, allowExternal = false, request = null) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const today = todayStr();
    const now = Date.now();
    const result = {};

    // 1. 先过一层内存缓存
    const toFetchFromPersist = [];
    for (const item of items) {
        const cached = INTRADAY_CACHE.get(item.code);
        if (cached && (now - cached.timestamp < CACHE_TTL)) {
            result[item.code] = cached.data;
        } else {
            toFetchFromPersist.push(item);
        }
    }

    if (toFetchFromPersist.length > 0) {
        // 2. 批量从 D1/持久化层 获取
        const dbDataMap = await getBulkIntraday(toFetchFromPersist, today);
        const externalFetchList = [];

        for (const item of toFetchFromPersist) {
            const dbData = dbDataMap[item.code];
            if (dbData && dbData.points && dbData.points.length > 0) {
                // 判断是否为今日数据 (分时点的时间通常不带横杠日期)
                const isToday = dbData.points[0]?.time?.includes(':') && !dbData.points[0]?.time?.includes('-');
                const updatedAt = dbData.updated_at ? new Date(dbData.updated_at).getTime() : 0;

                // 1. 如果是今日数据且足够新鲜，直接用
                // 普通用户请求 (allowExternal=false) 容忍 5 分钟 D1 陈旧度，Cron (allowExternal=true) 容忍 1 分钟
                const stalenessThreshold = allowExternal ? 60000 : 300000;
                if (isToday && (now - updatedAt < stalenessThreshold)) {
                    result[item.code] = dbData;
                    continue;
                }

                // 2. 如果不是今日数据（比如之前存的历史备份），但在非交易时段，也可以直接用
                // 此处我们允许在非外部抓取模式下直接返回已有的任何数据
                if (!allowExternal || !isToday) {
                    result[item.code] = dbData;
                    continue;
                }
            }
            if (allowExternal) {
                externalFetchList.push(item);
            }
        }

        if (externalFetchList.length > 0 && allowExternal) {
            // 3. 最后才去拉网络，分片串行以保护 Edge (减小并发压力)
            const CHUNK_SIZE = 5;
            const recordsToSave = [];

            for (let i = 0; i < externalFetchList.length; i += CHUNK_SIZE) {
                const chunk = externalFetchList.slice(i, i + CHUNK_SIZE);
                const chunkResults = await Promise.all(
                    chunk.map(async (item) => {
                        const data = await fetchSingleIntradayServer(item.code, allowExternal);
                        return { code: item.code, data };
                    })
                );

                for (const { code, data } of chunkResults) {
                    if (data) {
                        result[code] = data;
                        recordsToSave.push({ code, date: today, data });
                    }
                }

                if (i + CHUNK_SIZE < externalFetchList.length) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            // 批量持久化到 D1
            if (recordsToSave.length > 0) {
                await saveIntradayBatch(recordsToSave);
                console.log(`[Intraday] Batch saved ${recordsToSave.length} items to D1`);
            }
        }
    }

    return result;
}

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        const result = await syncIntradayBulk(items, allowExternal, request);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}

