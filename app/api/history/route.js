import { NextResponse } from 'next/server';
import { readDoc, writeDoc, getHistoryFromKV, insertDailyPricesBatch, addSystemLog } from '@/lib/storage';

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
};

function resolveMarket(code) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    let prefix = '';
    let clean = code;
    if (match) {
        prefix = match[1].toLowerCase();
        clean = match[2];
    }
    return { prefix, clean };
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchStockHistoryServer(code, days) {
    const { prefix, clean } = resolveMarket(code);
    const mkt = prefix === 'sz' ? '0' : '1';
    // 主数据源: 东方财富 K 线接口
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 5}`;
    try {
        const res = await fetchWithTimeout(url, {
            headers: {
                ...BASE_HEADERS,
                'Referer': 'https://quote.eastmoney.com/',
            }
        }, 8000);
        if (res.ok) {
            const d = await res.json();
            if (d.data && d.data.klines) {
                const data = d.data.klines.map(line => {
                    const parts = line.split(',');
                    return { date: parts[0], value: parseFloat(parts[1]) };
                }).filter(i => !isNaN(i.value));
                if (data.length > 0) {
                    await addSystemLog('INFO', 'History', `EastMoney fetch OK: ${code} (${data.length} pts)`);
                    return data.slice(-days);
                }
            }
        }
        await addSystemLog('WARN', 'History', `EastMoney returned non-ok for ${code}: ${res.status}`);
    } catch (e) {
        await addSystemLog('WARN', 'History', `EastMoney stock ${code} failed: ${e.message}`);
    }

    // 备用数据源: 尝试从腾讯 API 拼历史（仅当 eastmoney 失败时）
    try {
        const urls = [];
        for (let year = new Date().getFullYear(); year >= new Date().getFullYear() - 1; year--) {
            urls.push(`https://data.gtimg.cn/flashdata/hushen/daily/${String(year).slice(-2)}/${code.toLowerCase()}.js`);
        }
        for (const u of urls) {
            const res2 = await fetchWithTimeout(u, { headers: BASE_HEADERS }, 5000).catch(() => null);
            if (!res2 || !res2.ok) continue;
            const text = await res2.text();
            const lines = text.split('\n').filter(l => /^\d{6}/.test(l.trim()));
            if (lines.length > 0) {
                const data = lines.map(line => {
                    const parts = line.trim().split(' ');
                    const date = `20${parts[0].slice(0, 2)}-${parts[0].slice(2, 4)}-${parts[0].slice(4, 6)}`;
                    return { date, value: parseFloat(parts[2]) };
                }).filter(i => !isNaN(i.value));
                if (data.length > 0) {
                    await addSystemLog('INFO', 'History', `Tencent flashdata OK: ${code} (${data.length} pts)`);
                    return data.slice(-days);
                }
            }
        }
    } catch (e2) {
        await addSystemLog('WARN', 'History', `Tencent fallback also failed for ${code}: ${e2.message}`);
    }
    return null;
}

async function fetchFundHistoryServer(code, days) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i);
    const clean = match ? match[2] : code;
    try {
        const probeRes = await fetchWithTimeout(
            `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=20&_=${Date.now()}`,
            { headers: { ...BASE_HEADERS, 'Referer': `http://fundf10.eastmoney.com/` } },
            6000
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
                () => fetchWithTimeout(
                    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=${page}&pageSize=20&_=${Date.now()}`,
                    { headers: { ...BASE_HEADERS, 'Referer': `http://fundf10.eastmoney.com/` } },
                    4000
                ).then(r => r.ok ? r.json() : null).catch(() => null)
            );
        }

        const pageResults = [];
        const PAGE_BATCH_SIZE = 6;
        for (let i = 0; i < pagePromises.length; i += PAGE_BATCH_SIZE) {
            const batch = pagePromises.slice(i, i + PAGE_BATCH_SIZE);
            const batchRes = await Promise.all(batch.map(fn => fn()));
            pageResults.push(...batchRes);
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
        await addSystemLog('WARN', 'History', `Fund lsjz ${code} failed: ${e.message}`);
    }
    return null;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const type = searchParams.get('type');
    const days = parseInt(searchParams.get('days') || '250', 10);
    const noCache = searchParams.get('no_cache') === '1';

    if (!code || !type) {
        return NextResponse.json({ error: 'Missing code or type' }, { status: 400 });
    }

    try {
        const storageKey = `hist:${type}:${code}`;
        const today = todayStr();

        // 1. 检查 KV 日级缓存
        if (!noCache) {
            const entry = await readDoc(storageKey, null);
            if (entry && entry.date === today && Array.isArray(entry.history) && entry.history.length >= days * 0.7) {
                return NextResponse.json({
                    history: entry.history,
                    summary: calcStats(entry.history),
                    source: 'kv_cache'
                });
            }

            // 2. 从 KV 时序数据中读取历史记录
            const kvHistory = await getHistoryFromKV(code, type, days);
            if (kvHistory && kvHistory.length >= days * 0.7) {
                await addSystemLog('INFO', 'History', `KV timeseries hit: ${code} (${kvHistory.length}pts)`);
                return NextResponse.json({
                    history: kvHistory,
                    summary: calcStats(kvHistory),
                    source: 'kv_timeseries'
                });
            }
        }

        // 3. 外部 API 获取
        let history = null;
        if (type === 'stock') {
            history = await fetchStockHistoryServer(code, days);
        } else if (type === 'fund') {
            history = await fetchFundHistoryServer(code, days);
        }

        if (!history || history.length === 0) {
            await addSystemLog('WARN', 'History', `No data from any source for ${code} (${type})`);
            return NextResponse.json({ history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 }, source: 'empty' });
        }

        // 4. 写回 KV 缓存
        await writeDoc(storageKey, { date: today, history });
        const records = history.map(h => ({ code, type, price: h.value, date: h.date }));
        await insertDailyPricesBatch(records);

        return NextResponse.json({
            history,
            summary: calcStats(history),
            source: 'external_api'
        });
    } catch (e) {
        await addSystemLog('ERROR', 'History', `Crash for ${code}: ${e.message}`).catch(() => { });
        return NextResponse.json({
            error: e.message,
            stack: process.env.NODE_ENV !== 'production' ? e.stack : undefined
        }, { status: 500 });
    }
}
