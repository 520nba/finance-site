import { NextResponse } from 'next/server';

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
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/trends/get?secid=${market}.${clean}&fields1=f1,f2&fields2=f51,f52,f53`;

        // 增加信号超时处理，防止 Node.js fetch 无响应挂起
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, { headers: BASE_HEADERS, signal: controller.signal }).finally(() => clearTimeout(timeout));
        if (!res.ok) return null;
        const json = await res.json();
        const d = json.data;
        if (!d) return null;

        let points = [];
        let prePrice = (d.prePrice ?? d.preClose ?? 0) / 100;

        // 格式 1: d.trends 是字符串数组 (常规返回)
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
        }
        // 格式 2: d 本身是对象数组 (部分环境变体)
        else if (Array.isArray(d)) {
            points = d.map(item => {
                const val = parseFloat(item.f3);
                let timeStr = String(item.f2);
                if (timeStr.length >= 4) {
                    const hh = timeStr.slice(-4, -2);
                    const mm = timeStr.slice(-2);
                    timeStr = `${hh}:${mm}`;
                }
                return {
                    time: timeStr,
                    value: isNaN(val) ? 0 : val / 100
                };
            }).filter(p => p.value > 0);
        }

        if (points.length === 0) return null;

        const lastPrice = points[points.length - 1].value;
        const effectivePrevClose = prePrice || points[0].value;
        const changePercent = effectivePrevClose > 0 ? (lastPrice / effectivePrevClose - 1) : 0;

        return {
            code,
            price: lastPrice,
            changePercent,
            prevClose: effectivePrevClose,
            points
        };
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

        // 在服务端并发拉取所需的分时数据，绕过浏览器的连接数限制
        const fetched = await Promise.all(
            items.map(async (item) => {
                const data = await fetchSingleIntradayServer(item.code);
                return { code: item.code, data };
            })
        );

        // 整理返回结果
        for (const { code, data } of fetched) {
            if (data) {
                result[code] = data;
            }
        }

        return NextResponse.json(result);
    } catch (e) {
        console.error(`[Intraday Bulk] Error:`, e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
