import { NextResponse } from 'next/server';
import { getGlobalUniqueAssets } from '@/lib/storage/userRepo';
import { syncNamesBulk } from '@/app/api/names/bulk/route';
import { refreshStockHistoryTransaction, incrementalUpdateFundHistory, getHistory } from '@/lib/storage/historyRepo';
import { saveIntradayPointsBulk, pruneIntradayPoints } from '@/lib/storage/intradayRepo';

// 基础 Headers
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
};

/**
 * 带有超时控制的 fetch 包装
 */
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

/**
 * 获取股票 250 天历史 (前复权)
 */
async function fetchRawStockHistory(code, days = 250) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    if (!match) return null;
    const mkt = match[1].toLowerCase() === 'sz' ? '0' : '1';
    const clean = match[2];
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 5}`;
    try {
        const res = await fetchWithTimeout(url);
        if (res.ok) {
            const d = await res.json();
            if (d.data?.klines) {
                return d.data.klines.map(line => {
                    const parts = line.split(',');
                    return { date: parts[0], value: parseFloat(parts[1]) };
                }).filter(i => !isNaN(i.value));
            }
        }
    } catch (e) { console.error(`[Cron] Fetch Raw Stock History failed for ${code}:`, e.message); }
    return null;
}

/**
 * 获取基金增量历史
 */
async function fetchRawFundHistory(code, startDate) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i);
    const clean = match ? match[2] : code;
    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=40&_=${Date.now()}`;
        const res = await fetchWithTimeout(url, { headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' } });
        if (res.ok) {
            const d = await res.json();
            const list = d.Data?.LSJZList || [];
            return list
                .filter(item => !startDate || item.FSRQ > startDate)
                .map(item => ({ date: item.FSRQ, value: parseFloat(item.DWJZ) }))
                .filter(i => !isNaN(i.value))
                .reverse();
        }
    } catch (e) { console.error(`[Cron] Fetch Raw Fund History failed for ${code}:`, e.message); }
    return null;
}

/**
 * 获取股票当前报价用于分时点点抓取
 */
async function fetchCurrentIntradayPoint(code) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    if (!match) return null;
    const mkt = match[1].toLowerCase() === 'sz' ? '0' : '1';
    const clean = match[2];
    // 使用极速实时行情接口，仅抓取最新价和时间
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${mkt}.${clean}&fields=f43,f58,f86`;
    try {
        const res = await fetchWithTimeout(url);
        if (res.ok) {
            const d = await res.json();
            const f = d.data;
            if (f && f.f43 !== '-') {
                // f43: 价格(需除以100), f86: 时间
                const price = f.f43 / 100;
                const timeStr = f.f86; // HHmmss
                const now = new Date();
                const bjTime = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().split('T')[0];
                const fullTime = `${bjTime} ${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
                return { code, time: fullTime, price, vol: 0 };
            }
        }
    } catch (e) { /* ignore single failure */ }
    return null;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const envSecret = process.env.CRON_SECRET;
    // 允许通过任务名绕过 token 用于调试 (生产环境请务必加上鉴权)
    if (!envSecret || token !== envSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 获取北京时间当前小时
    const now = new Date();
    const bjNow = new Date(now.getTime() + (8 * 3600 * 1000));
    const bjHour = bjNow.getUTCHours();
    const bjMinute = bjNow.getUTCMinutes();
    const task = searchParams.get('task') || 'auto';

    try {
        const itemsToSync = await getGlobalUniqueAssets();
        if (itemsToSync.length === 0) return NextResponse.json({ success: true, message: 'No assets' });

        const results = { task_executed: [] };

        // 1. 股票北京时间凌晨 4:00 全量刷新 250 天历史
        if (task === 'stock_refresh' || (task === 'auto' && bjHour === 4 && bjMinute < 10)) {
            results.task_executed.push('stock_refresh');
            const stocks = itemsToSync.filter(i => i.type === 'stock');
            for (const s of stocks) {
                const history = await fetchRawStockHistory(s.code, 250);
                if (history) await refreshStockHistoryTransaction(s.code, history);
            }
        }

        // 2. 基金北京时间凌晨 3:00 增量刷新
        if (task === 'fund_update' || (task === 'auto' && bjHour === 3 && bjMinute < 10)) {
            results.task_executed.push('fund_update');
            const funds = itemsToSync.filter(i => i.type === 'fund');
            for (const f of funds) {
                const currentHistory = await getHistory(f.code, 'fund', 1);
                const lastDate = currentHistory.length > 0 ? currentHistory[0].date : null;
                const newRecords = await fetchRawFundHistory(f.code, lastDate);
                if (newRecords && newRecords.length > 0) {
                    await incrementalUpdateFundHistory(f.code, newRecords);
                }
            }
        }

        // 3. 交易时间北京时间每分钟的分时点抓取 (9:30-11:30, 13:00-15:00)
        // 对应任务里的 * 1-3,5-7 (GMT) -> BJ 9-11, 13-15
        const isMarketTime = (bjHour === 9 && bjMinute >= 30) || (bjHour === 10) || (bjHour === 11 && bjMinute <= 30) ||
            (bjHour >= 13 && bjHour < 15) || (bjHour === 15 && bjMinute === 0);

        if (task === 'intraday_poll' || (task === 'auto' && isMarketTime)) {
            results.task_executed.push('intraday_poll');
            const stocks = itemsToSync.filter(i => i.type === 'stock');
            const points = await Promise.all(stocks.map(s => fetchCurrentIntradayPoint(s.code)));
            const validPoints = points.filter(p => p !== null);
            if (validPoints.length > 0) {
                await saveIntradayPointsBulk(validPoints);
            }
        }

        // 4. 北京时间 15:30 收盘清理
        if (task === 'intraday_cleanup' || (task === 'auto' && bjHour === 15 && bjMinute === 30)) {
            results.task_executed.push('intraday_cleanup');
            await pruneIntradayPoints();
        }

        // 5. 基础名称同步 (每天 2 点)
        if (task === 'names' || (task === 'auto' && bjHour === 2 && bjMinute < 10)) {
            results.task_executed.push('names');
            await syncNamesBulk(itemsToSync, true);
        }

        return NextResponse.json({ success: true, results, bjTime: bjNow.toISOString() });

    } catch (e) {
        console.error('[Cron] Sync crashed:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

