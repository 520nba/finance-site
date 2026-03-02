import { NextResponse } from 'next/server';
import { getIntradayFromDB, saveIntradayToDB, addSystemLog } from '@/lib/storage';

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
            return cached.data;
        }

        // 2. 优先尝试从 D1 数据库获取 (有效期 1 分钟)
        const dbData = await getIntradayFromDB(code, today, true); // 开启 fallbackToLatest
        if (dbData && dbData.points && dbData.points.length > 0) {
            // 如果是今天的数据，检查 1 分钟新鲜度
            const isToday = dbData.points[0]?.time?.includes(':') && !dbData.points[0]?.time?.includes('-');
            const updatedAt = dbData.updated_at ? new Date(dbData.updated_at).getTime() : 0;
            if (now - updatedAt < 60000 || !isToday) {
                if (!isToday) addSystemLog('INFO', 'Intraday', `Using non-trading day fallback for ${code}`);
                return dbData;
            }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, { headers: BASE_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timeout));
        if (!res.ok) return dbData; // 失败时返回 DB 里的（可能是昨天的）数据
        const json = await res.json();
        const d = json.data;
        if (!d || !d.trends || d.trends.length === 0) {
            // 如果远程返回空（非交易日），则彻底信任并返回 DB 中的上一个交易日数据
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

        // 4. 异步写入 D1 数据库进行持久化缓存
        saveIntradayToDB(code, today, { ...result, updated_at: new Date().toISOString() });

        return result;
    } catch (e) {
        console.error(`[Intraday Bulk] Failed for ${code}:`, e.message);
        return null;
    }
}

export async function POST(request) {
    try {
        const { items } = await request.json();
        if (!Array.isArray(items) || items.length === 0) return NextResponse.json({});

        const result = {};
        const CHUNK_SIZE = 15;

        // 分批次并发请求，规避 Workers 子请求并发限制
        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
            const chunk = items.slice(i, i + CHUNK_SIZE);
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

        return NextResponse.json(result);
    } catch (e) {
        console.error(`[Intraday Bulk] Error:`, e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
