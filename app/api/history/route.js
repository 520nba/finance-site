import { NextResponse } from 'next/server';
import { getHistory, insertDailyPricesBatch } from '@/lib/storage/historyRepo';
import { fetchStockHistory, fetchFundHistory } from '@/lib/services/historyFetcher'
import { calculateStats } from '@/lib/utils'

function todayStr(date = new Date()) {
    return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

import { EASTMONEY_HEADERS } from '@/lib/constants/headers';

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
        const today = todayStr();

        // 1. 优先从 D1 读取
        if (!noCache) {
            const kvHistory = await getHistory(code, type, days);
            const hasEnough = kvHistory && kvHistory.length >= days * 0.7;

            // 如果数据量够，或者最新的一条数据就是今天/昨天，说明已经同步过了
            const lastDate = kvHistory.length > 0 ? kvHistory[kvHistory.length - 1].date : null;
            const yesterday = todayStr(new Date(Date.now() - 86400000));
            const isFresh = lastDate && (lastDate === today || lastDate === yesterday);

            if (hasEnough || isFresh) {
                console.log(`[History] D1 hit ${isFresh ? '(Fresh)' : '(Enough)'}: ${code}`);
                return NextResponse.json({
                    history: kvHistory,
                    summary: calculateStats(kvHistory),
                    source: 'd1_storage'
                });
            }
        }

        // 3. 外部 API 获取
        let history = null;
        if (type === 'stock') {
            history = await fetchStockHistory(code, days);
        } else if (type === 'fund') {
            history = await fetchFundHistory(code, days);
        }

        if (!history || history.length === 0) {
            console.warn(`[History] No data from any source for ${code} (${type})`);
            return NextResponse.json({ history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 }, source: 'empty' });
        }

        // 4. 写回 D1 缓存 (只用 insertDailyPricesBatch，避免 writeDoc 双重写入)
        const records = history.map(h => ({ code, type, price: h.value, date: h.date }));
        await insertDailyPricesBatch(records);

        return NextResponse.json({
            history,
            summary: calculateStats(history),
            source: 'external_api'
        });
    } catch (e) {
        console.error(`[History] Crash for ${code}: ${e.message}`);
        return NextResponse.json({
            error: e.message,
            stack: process.env.NODE_ENV !== 'production' ? e.stack : undefined
        }, { status: 500 });
    }
}
