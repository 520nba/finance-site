import { NextResponse } from 'next/server';
import { getIntradayFromKV, saveIntradayToKV, getBulkIntradayFromKV, addSystemLog } from '@/lib/storage';

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
    const clean = code.replace(/^(sh|sz)/i, '');
    let market = '1'; // 默认 SH
    if (code.toLowerCase().startsWith('sz')) {
        market = '0';
    } else if (!code.toLowerCase().startsWith('sh')) {
        market = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    }
    return { market, clean };
}

async function fetchSingleIntradayServer(code) {
    const { market, clean } = resolveMarket(code);
    const today = todayStr();
    const now = Date.now();

    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/trends/get?secid=${market}.${clean}&fields1=f1,f2&fields2=f51,f52,f53`;

        // 1. 检查内存缓存 (30秒)
        const cached = INTRADAY_CACHE.get(code);
        if (cached && (now - cached.timestamp < CACHE_TTL)) {
            await addSystemLog('INFO', 'Intraday', `Memory Cache Hit: ${code}`);
            return cached.data;
        }

        // 2. 优先尝试从 KV 缓存获取 (有效期 1 分钟)
        const dbData = await getIntradayFromKV(code, today, true); // 开启 fallbackToLatest
        if (dbData && dbData.points && dbData.points.length > 0) {
            // 如果是今天的数据，检查 1 分钟新鲜度
            const isToday = dbData.points[0]?.time?.includes(':') && !dbData.points[0]?.time?.includes('-');
            const updatedAt = dbData.updated_at ? new Date(dbData.updated_at).getTime() : 0;
            if (now - updatedAt < 60000 || !isToday) {
                if (isToday) {
                    await addSystemLog('INFO', 'Intraday', `KV Cache Hit: ${code} (Fresh)`);
                } else {
                    await addSystemLog('INFO', 'Intraday', `Using non-trading day fallback for ${code}`);
                }
                return dbData;
            }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, { headers: BASE_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timeout));
        if (!res.ok) return dbData; // 失败时返回 KV 里的（可能是昨天的）数据
        const json = await res.json();
        const d = json.data;
        if (!d || !d.trends || d.trends.length === 0) {
            // 如果远程返回空（非交易日），则彻底信任并返回 KV 中的上一个交易日数据
            return dbData;
        }

        let points = [];
        let prePrice = (d.prePrice ?? d.preClose ?? 0) / 100;

        if (d.trends && Array.isArray(d.trends)) {
            points = d.trends.map(line => {
                const parts = line.split(',');
                const fullTime = parts[0];
                const timePart = fullTime.includes(' ') ? fullTime.split(' ')[1] : fullTime;
                const val = parseFloat(parts[2]);
                return {
                    time: timePart,
                    value: isNaN(val) ? 0 : val / 100
                };
            }).filter(p => p.value > 0);
        } else if (Array.isArray(d)) {
            points = d.map(item => {
                const val = parseFloat(item.f3);
                let timeStr = String(item.f2);
                if (timeStr.length >= 4) {
                    const hh = timeStr.slice(-4, -2);
                    const mm = timeStr.slice(-2);
                    timeStr = `${hh}:${mm}`;
                }
                return { time: timeStr, value: isNaN(val) ? 0 : val / 100 };
            }).filter(p => p.value > 0);
        }

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
        await addSystemLog('INFO', 'Intraday', `External Fetch: ${code}`);

        // 4. 异步写入 KV 缓存进行持久化
        await saveIntradayToKV(code, today, { ...result, updated_at: new Date().toISOString() });

        return result;
    } catch (e) {
        console.error(`[Intraday Bulk] Failed for ${code}:`, e.message);
        return null;
    }
}

export async function syncIntradayBulk(items, allowExternal = false) {
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
        // 2. 批量从 KV 获取
        const dbDataMap = await getBulkIntradayFromKV(toFetchFromPersist, today);
        const externalFetchList = [];

        for (const item of toFetchFromPersist) {
            const dbData = dbDataMap[item.code];
            if (dbData && dbData.points && dbData.points.length > 0) {
                // 判断是否为今日数据 (分时点的时间通常不带横杠日期)
                const isToday = dbData.points[0]?.time?.includes(':') && !dbData.points[0]?.time?.includes('-');
                const updatedAt = dbData.updated_at ? new Date(dbData.updated_at).getTime() : 0;

                // 1. 如果是今日数据且足够新鲜，直接用
                if (isToday && (now - updatedAt < 60000)) {
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
            // 3. 最后才去拉网络，分片串行以保护 Edge
            const CHUNK_SIZE = 10;
            for (let i = 0; i < externalFetchList.length; i += CHUNK_SIZE) {
                const chunk = externalFetchList.slice(i, i + CHUNK_SIZE);
                const chunkResults = await Promise.all(
                    chunk.map(async (item) => {
                        const data = await fetchSingleIntradayServer(item.code);
                        return { code: item.code, data };
                    })
                );
                for (const { code, data } of chunkResults) {
                    if (data) result[code] = data;
                }
            }
        }
    }

    return result;
}

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        const result = await syncIntradayBulk(items, allowExternal);
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

