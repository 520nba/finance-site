/**
 * 股票与基金数据获取接口封装 (全站升级为东方财富 UTF-8 数据源)
 */

// ── 网络层 ──────────────────────────────────────────

async function fetchWithProxy(url) {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
        console.warn(`[Proxy] ${res.status} for ${url}`);
    }
    return res;
}

function resolveMarket(code) {
    const clean = code.replace(/^(sh|sz)/i, '');
    let market = '1'; // 默认 SH
    if (code.toLowerCase().startsWith('sz')) {
        market = '0';
    } else if (!code.toLowerCase().startsWith('sh')) {
        // 自动识别：6/5 开头为沪市，其余通常为深市
        market = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    }
    return { market, clean };
}

// ─────────────────────────────────────────────

/** 获取股票实时数据（东方财富） */
export async function fetchStockData(code) {
    const { market, clean } = resolveMarket(code);
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f57,f58,f43,f169,f170`;
        const res = await fetchWithProxy(url);
        if (!res.ok) return null;
        const json = await res.json();
        const d = json.data;
        if (!d || !d.f58) return null;

        return {
            name: d.f58,
            code: code,
            price: d.f43 / 100, // 价格单位通常是分
            change: d.f169 / 100,
            changePercent: d.f170 / 100,
        };
    } catch (e) {
        console.error(`[API] fetchStockData failed for ${code}:`, e.message);
        return null;
    }
}

/** 获取股票历史 K 线（走服务端缓存端点 /api/history） */
export async function fetchStockHistory(code, days = 250) {
    try {
        const res = await fetch(`/api/history?code=${code}&type=stock&days=${days}`);
        if (!res.ok) return { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
        return await res.json();
    } catch (e) {
        return { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
    }
}

/** 获取基金历史净值（走服务端缓存端点 /api/history） */
export async function fetchFundHistory(code, days = 250) {
    try {
        const res = await fetch(`/api/history?code=${code}&type=fund&days=${days}`);
        if (!res.ok) return { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
        return await res.json();
    } catch (e) {
        return { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
    }
}

/** 获取基金基础信息 (部分场外基金仍需 fundgz 兜底) */
export async function fetchFundInfo(code) {
    try {
        const res = await fetchWithProxy(`https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`);
        if (res.ok) {
            const text = await res.text();
            const match = text.match(/jsonpgz\((.+)\)/);
            if (match) {
                const json = JSON.parse(match[1]);
                if (json.name) return { name: json.name, code };
            }
        }
    } catch { }

    // 备选方案：通过东方财富实时接口推断
    const stock = await fetchStockData(code);
    if (stock) return { name: stock.name, code };

    return null;
}

/** 批量获取历史数据 */
export async function fetchBulkHistory(items, days = 250) {
    try {
        const res = await fetch('/api/history/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, days }),
        });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

/** 批量获取股票实时行情 (东方财富 ulist API) */
export async function fetchBulkStockData(stocks) {
    if (stocks.length === 0) return {};
    const secids = stocks.map(s => {
        const { market, clean } = resolveMarket(s.code);
        return `${market}.${clean}`;
    }).join(',');

    try {
        const url = `https://push2.eastmoney.com/api/qt/ulist/get?secids=${secids}&fields=f12,f14,f2,f3,f4`;
        const res = await fetchWithProxy(url);
        if (!res.ok) return {};
        const json = await res.json();
        const list = json.data?.diff || [];
        const result = {};

        list.forEach(d => {
            result[d.f12] = {
                name: d.f14,
                code: d.f12,
                price: d.f2 / 100,
                changePercent: d.f3 / 100,
                change: d.f4 / 100,
            };
        });
        return result;
    } catch (e) {
        return {};
    }
}

/** 批量获取名称 */
export async function fetchBulkNames(items) {
    try {
        const res = await fetch('/api/names/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
        });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

/** 获取分时行情数据 (EastMoney Trends API) */
export async function fetchIntradayData(code, type) {
    const { market, clean } = resolveMarket(code);
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/trends/get?secid=${market}.${clean}&fields1=f1,f2,f3&fields2=f51,f53,f58`;
        const res = await fetchWithProxy(url);
        if (!res.ok) return null;
        const json = await res.json();
        const d = json.data;
        if (!d || !d.trends) return null;

        const points = d.trends.map(line => {
            const parts = line.split(',');
            // parts[0]: 2024-02-28 09:30, parts[1]: price
            const timePart = parts[0].split(' ')[1];
            return {
                time: timePart,
                value: parseFloat(parts[1])
            };
        });

        return {
            code,
            name: d.name,
            price: d.prePrice, // 这里的 prePrice 可能是昨收，需要确认字段。
            changePercent: (((points[points.length - 1].value / d.prePrice) - 1) * 100),
            prevClose: d.prePrice,
            points
        };
    } catch (e) {
        return null;
    }
}
