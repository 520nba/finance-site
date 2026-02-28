import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage';

export const runtime = 'edge';

function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function resolveMarket(code) {
    const clean = code.replace(/^(sh|sz)/i, '');
    if (code.toLowerCase().startsWith('sh')) return { market: '1', code: clean };
    if (code.toLowerCase().startsWith('sz')) return { market: '0', code: clean };
    const prefix = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    return { market: prefix, code: clean };
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
    'Referer': 'https://quote.eastmoney.com/',
};

async function fetchHistoryEastMoney(code, days) {
    const { market, code: cleanCode } = resolveMarket(code);
    try {
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${market}.${cleanCode}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&beg=0&end=20500101`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;
        const json = await res.json();
        const klines = json.data?.klines || [];
        if (klines.length === 0) return null;

        return klines
            .map(line => {
                const [date, close] = line.split(',');
                return { date, value: parseFloat(close) };
            })
            .filter(i => !isNaN(i.value))
            .slice(-days);
    } catch (e) {
        console.error(`[History] EastMoney kline failed for ${code}:`, e.message);
        return null;
    }
}

async function fetchFundHistoryEastMoney(code, days) {
    // 场内基金优先 K 线
    const isListed = code.startsWith('5') || code.startsWith('15') || code.startsWith('16') || code.startsWith('58');
    if (isListed) {
        const d = await fetchHistoryEastMoney(code, days);
        if (d) return d;
    }

    // 场外基金：东财 lsjz API
    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${days}&_=${Date.now()}`;
        const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html` } });
        if (!res.ok) return null;
        const json = await res.json();
        const list = json.Data?.LSJZList || [];
        if (list.length === 0) return null;
        return list
            .map(item => ({ date: item.FSRQ, value: parseFloat(item.DWJZ) }))
            .filter(i => !isNaN(i.value))
            .reverse();
    } catch (e) {
        console.error(`[History] Fund lsjz failed for ${code}:`, e.message);
        return null;
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
        history = await fetchHistoryEastMoney(code, days);
    } else if (type === 'fund') {
        history = await fetchFundHistoryEastMoney(code, days);
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } });
    }

    await writeDoc(storageKey, { date: today, history });
    return NextResponse.json({
        history,
        summary: calcStats(history)
    });
}
