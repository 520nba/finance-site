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
        market = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    }
    return { market, clean };
}

// ── 实时行情 ──────────────────────────────────────────

/** 获取单只股票实时数据（东方财富 stock/get） */
export async function fetchStockData(code) {
    const { market, clean } = resolveMarket(code);
    try {
        // 使用 f3/f170 兼容百分比
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f57,f58,f43,f169,f3,f170,f18`;
        const res = await fetchWithProxy(url);
        if (!res.ok) return null;
        const json = await res.json();
        const d = json.data;
        if (!d || d.f43 === undefined) return null;

        // 兼容处理涨跌幅字段
        const pc = (d.f3 !== undefined && d.f3 !== null) ? d.f3 : (d.f170 ?? 0);

        return {
            name: d.f58,
            code: code,
            price: d.f43 / 100,
            change: d.f169 / 100,
            changePercent: pc / 100,
            prevClose: d.f18 / 100
        };
    } catch (e) {
        console.error(`[API] fetchStockData failed for ${code}:`, e.message);
        return null;
    }
}

/** 批量获取股票实时行情（走服务端 D1 缓存，不再直接调用外部） */
export async function fetchBulkStockData(stocks, allowExternal = false) {
    if (stocks.length === 0) return {};
    try {
        const res = await fetch('/api/quotes/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: stocks, allowExternal }),
        });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        console.error(`[API] fetchBulkStockData via Backend failed:`, e.message);
        return {};
    }
}

// ── 历史数据 ──────────────────────────────────────────

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

/** 批量获取历史数据 */
export async function fetchBulkHistory(items, allowExternal = false, days = 250) {
    try {
        const res = await fetch('/api/history/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, days, allowExternal }),
        });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

// ── 基金信息 ──────────────────────────────────────────

/** 获取基金基础信息 */
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
    // 备选：stock/get
    const stock = await fetchStockData(code);
    if (stock) return { name: stock.name, code };
    return null;
}

// ── 批量名称 ──────────────────────────────────────────

/** 批量获取名称 */
export async function fetchBulkNames(items, allowExternal = false) {
    try {
        const res = await fetch('/api/names/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, allowExternal }),
        });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

// ── 分时数据 ──────────────────────────────────────────

/** 获取分时行情数据 (EastMoney Trends API) */
export async function fetchIntradayData(code, type) {
    const { market, clean } = resolveMarket(code);
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/trends/get?secid=${market}.${clean}&fields1=f1,f2&fields2=f51,f52,f53`;
        const res = await fetchWithProxy(url);
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
        // 统一返回核心字段：现价、涨跌幅、昨收、分时点
        // 注意：这里的 changePercent 返回小数，方便前端统一格式化
        const changePercent = effectivePrevClose > 0 ? ((lastPrice / effectivePrevClose - 1) * 100) : 0;

        return {
            code,
            price: lastPrice,
            changePercent,
            prevClose: effectivePrevClose,
            points
        };
    } catch (e) {
        console.error(`[API] fetchIntradayData failed for ${code}:`, e.message);
        return null;
    }
}

/** 批量获取分时行情数据 (走服务端并发获取，绕过浏览器限制) */
export async function fetchBulkIntradayData(items, allowExternal = false) {
    if (items.length === 0) return {};
    try {
        const res = await fetch('/api/intraday/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, allowExternal }),
        });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        console.error(`[API] fetchBulkIntradayData failed:`, e.message);
        return {};
    }
}
