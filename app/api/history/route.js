import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage';

export const runtime = 'edge';

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function resolveMarket(code) {
    const lower = code.toLowerCase();
    if (lower.startsWith('sh')) return { prefix: 'sh', clean: code.substring(2) };
    if (lower.startsWith('sz')) return { prefix: 'sz', clean: code.substring(2) };
    return { prefix: (code.startsWith('6') || code.startsWith('5')) ? 'sh' : 'sz', clean: code };
}

function calcStats(history) {
    if (!history || history.length < 2) return { perf5d: 0, perf22d: 0, perf250d: 0 };
    const getPerf = (days) => {
        const data = history.slice(-(days + 1));
        if (data.length < 2) return 0;
        return ((data[data.length - 1].value / data[0].value) - 1) * 100;
    };
    return {
        perf5d: getPerf(5),
        perf22d: getPerf(22),
        perf250d: getPerf(250)
    };
}

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
};

function parseSinaKlines(jsonData, days) {
    if (!Array.isArray(jsonData)) return null;
    const result = jsonData
        .map(item => ({ date: item.day, value: parseFloat(item.close) }))
        .filter(i => i.date && !isNaN(i.value));
    return result.length > 0 ? result.slice(-days) : null;
}

async function fetchStockHistoryServer(code, days) {
    const { prefix, clean } = resolveMarket(code);
    const candidates = [`${prefix}${clean}`, `${prefix === 'sh' ? 'sz' : 'sh'}${clean}`];
    for (const sinaCode of candidates) {
        try {
            const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=${days + 10}`;
            const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://finance.sina.com.cn/' } });
            if (!res.ok) continue;
            const text = await res.text();
            const cleanText = text.replace(/^\uFEFF/, '').trim();
            if (!cleanText || cleanText === 'null') continue;
            const data = parseSinaKlines(JSON.parse(cleanText), days);
            if (data) return data;
        } catch (e) {
            console.warn(`[History] Sina stock ${sinaCode} failed:`, e.message);
        }
    }
    return null;
}

async function fetchFundHistoryServer(code, days) {
    const isListed = code.startsWith('5') || code.startsWith('15') || code.startsWith('16') || code.startsWith('58');
    const getSina = async () => {
        for (const sinaCode of [`sz${code}`, `sh${code}`]) {
            try {
                const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=${days + 10}`;
                const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://finance.sina.com.cn/' } });
                if (!res.ok) continue;
                const text = await res.text();
                const cleanText = text.replace(/^\uFEFF/, '').trim();
                if (!cleanText || cleanText === 'null') continue;
                const data = parseSinaKlines(JSON.parse(cleanText), days);
                if (data) return data;
            } catch (e) {
                console.warn(`[History] Sina fund ${sinaCode} failed:`, e.message);
            }
        }
        return null;
    };
    const getEastMoney = async () => {
        try {
            const probeRes = await fetch(
                `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=20&_=${Date.now()}`,
                { headers: { ...BASE_HEADERS, 'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html` } }
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
                    fetch(
                        `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=20&_=${Date.now()}`,
                        { headers: { ...BASE_HEADERS, 'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html` } }
                    ).then(r => r.ok ? r.json() : null)
                );
            }
            const pageResults = await Promise.all(pagePromises);
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
            console.error(`[History] Fund lsjz failed for ${code}:`, e.message);
        }
        return null;
    };
    if (isListed) {
        const d = await getSina();
        if (d) return d;
        return await getEastMoney();
    } else {
        const d = await getEastMoney();
        if (d) return d;
        return await getSina();
    }
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const type = searchParams.get('type');
    const days = parseInt(searchParams.get('days') || '250', 10);
    if (!code || !type) {
        return NextResponse.json({ error: 'Missing code or type' }, { status: 400 });
    }
    const storageKey = `hist:${type}:${code}`;
    const today = todayStr();
    const entry = await readDoc(storageKey, null);
    if (entry && entry.date === today && Array.isArray(entry.history) && entry.history.length >= days * 0.7) {
        return NextResponse.json({
            history: entry.history,
            summary: calcStats(entry.history)
        });
    }
    let history = null;
    if (type === 'stock') {
        history = await fetchStockHistoryServer(code, days);
    } else if (type === 'fund') {
        history = await fetchFundHistoryServer(code, days);
    }
    if (!history || history.length === 0) {
        return NextResponse.json([], { status: 200 });
    }
    await writeDoc(storageKey, { date: today, history });
    return NextResponse.json({
        history: history,
        summary: calcStats(history)
    });
}
