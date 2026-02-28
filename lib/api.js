/**
 * 股票与基金数据获取接口封装
 *
 * 历史数据通过 /api/history 获取（服务端缓存，当日有效）
 * 实时数据仍通过 /api/proxy 获取（腾讯 qtimg、东财 fundgz）
 */

// ── 网络层 ──────────────────────────────────────────

// 通过 Next.js 代理发起请求（代理负责 GBK 解码和 Referer 注入）
async function fetchWithProxy(url) {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
        console.warn(`[Proxy] ${res.status} for ${url}`);
    }
    return res;
}

// 将代码解析为 { prefix: 'sh'|'sz', clean: '数字部分' }
function resolveMarket(code) {
    const lower = code.toLowerCase();
    if (lower.startsWith('sh')) return { prefix: 'sh', clean: code.substring(2) };
    if (lower.startsWith('sz')) return { prefix: 'sz', clean: code.substring(2) };
    // 6xxxxx/5xxxxx → 上交所（A股 + 场内ETF：510xxx/512xxx/518xxx等）
    // 其余 → 深交所（000xxx, 002xxx, 300xxx, 159xxx, 16xxxx 等）
    const prefix = (code.startsWith('6') || code.startsWith('5')) ? 'sh' : 'sz';
    return { prefix, clean: code };
}

// 解析腾讯财经股票行情文本（/q=sh600000 格式）
// parts[1]=名称, parts[3]=现价, parts[31]=涨跌额, parts[32]=涨跌幅%
function parseTencentStock(text, originalCode) {
    const parts = text.split('~');
    if (parts.length < 33 || text.includes('pv_none')) return null;
    return {
        name: parts[1],
        code: originalCode,
        price: parseFloat(parts[3]),
        change: parseFloat(parts[31]),
        changePercent: parseFloat(parts[32]),
    };
}

// ─────────────────────────────────────────────

// 解析腾讯行情多码批量响应（格式同单码，多行 v_sh600036="..."; v_sz000001="...";）
function parseTencentMultiLine(text) {
    const result = {};
    const lines = text.split(';').map(s => s.trim()).filter(s => s.startsWith('v_'));
    for (const line of lines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const keyRaw = line.substring(2, eqIdx); // e.g. sh600036
        const value = line.substring(eqIdx + 2, line.length - 1); // strip =" and "
        const parts = value.split('~');
        if (parts.length < 33 || value.includes('pv_none')) continue;
        result[keyRaw] = {
            name: parts[1],
            price: parseFloat(parts[3]),
            change: parseFloat(parts[31]),
            changePercent: parseFloat(parts[32]),
        };
    }
    return result;
}

/** 获取股票实时数据（腾讯财经） */
export async function fetchStockData(code) {
    const { prefix, clean } = resolveMarket(code);
    const candidates = [`${prefix}${clean}`, `${prefix === 'sh' ? 'sz' : 'sh'}${clean}`];

    for (const finalCode of candidates) {
        try {
            const res = await fetchWithProxy(`https://qt.gtimg.cn/q=${finalCode}`);
            if (!res.ok) continue;
            const text = await res.text();
            const data = parseTencentStock(text, code);
            if (data) return data;
        } catch (e) {
            console.warn(`[API] fetchStockData candidate ${finalCode} failed:`, e.message);
        }
    }

    console.error(`[API] No valid stock data found for ${code}`);
    return null;
}

/** 获取股票历史 K 线（走服务端缓存端点 /api/history） */
export async function fetchStockHistory(code, days = 250) {
    try {
        const res = await fetch(`/api/history?code=${code}&type=stock&days=${days}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.error(`[API] fetchStockHistory failed for ${code}:`, e.message);
        return [];
    }
}

/** 获取基金历史净值（走服务端缓存端点 /api/history） */
export async function fetchFundHistory(code, days = 250) {
    try {
        const res = await fetch(`/api/history?code=${code}&type=fund&days=${days}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.error(`[API] fetchFundHistory failed for ${code}:`, e.message);
        return [];
    }
}

/** 获取基金基础信息（名称等）
 *  优先：fundgz.1234567.com.cn JSONP（同时含实时估值，与 lsjz 完全解耦，不产生并发冲突）
 *  Fallback：腾讯 qtimg（上市 ETF）
 */
export async function fetchFundInfo(code) {
    // 方案 A：天天基金估值接口（JSONP，含 name、dwjz）
    try {
        const res = await fetchWithProxy(
            `https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`
        );
        if (res.ok) {
            const text = await res.text();
            // 格式: jsonpgz({...});
            const match = text.match(/jsonpgz\((.+)\)/);
            if (match) {
                const json = JSON.parse(match[1]);
                if (json.name) return { name: json.name, code };
            }
        }
    } catch (e) {
        console.warn(`[API] fetchFundInfo fundgz failed for ${code}:`, e.message);
    }

    // 方案 B：腾讯行情接口（上市 ETF，不适用于开放式基金）
    const { prefix, clean } = resolveMarket(code);
    for (const qtCode of [`${prefix}${clean}`, `${prefix === 'sh' ? 'sz' : 'sh'}${clean}`]) {
        try {
            const res = await fetchWithProxy(`https://qt.gtimg.cn/q=${qtCode}`);
            if (!res.ok) continue;
            const text = await res.text();
            const parts = text.split('~');
            if (parts.length >= 2 && parts[1] && !text.includes('pv_none')) {
                return { name: parts[1], code };
            }
        } catch (e) {
            console.warn(`[API] fetchFundInfo qtimg ${qtCode} failed:`, e.message);
        }
    }

    return null;
}

/**
 * 批量获取历史数据（1个HTTP请求返回全部）
 * @param {Array<{code: string, type: 'stock'|'fund'}>} items
 * @returns {Object} { 'stock:600036': [...], 'fund:012831': [...] }
 */
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
        console.error('[API] fetchBulkHistory failed:', e.message);
        return {};
    }
}

/**
 * 批量获取股票实时行情（腾讯 qtimg 支持多码单请求）
 * @param {Array<{code: string}>} stocks
 * @returns {Object} { '600036': {name, price, change, changePercent, code}, ... }
 */
export async function fetchBulkStockData(stocks) {
    if (stocks.length === 0) return {};

    const BATCH = 15; // qtimg 单次多码上限（避免 URL 过长触发 500）
    const result = {};

    // 分批并发
    const chunks = [];
    for (let i = 0; i < stocks.length; i += BATCH) chunks.push(stocks.slice(i, i + BATCH));

    const chunkResults = await Promise.all(chunks.map(async (chunk) => {
        const codeList = chunk.map(({ code }) => {
            const { prefix, clean } = resolveMarket(code);
            return `${prefix}${clean}`;
        });
        try {
            const res = await fetchWithProxy(`https://qt.gtimg.cn/q=${codeList.join(',')}`);
            if (!res.ok) throw new Error(`${res.status}`);
            return { chunk, parsed: parseTencentMultiLine(await res.text()) };
        } catch (e) {
            console.warn(`[API] fetchBulkStockData chunk failed (${codeList.join(',')}):`, e.message);
            return { chunk, parsed: {} };
        }
    }));

    for (const { chunk, parsed } of chunkResults) {
        for (const stock of chunk) {
            const { prefix, clean } = resolveMarket(stock.code);
            const key = `${prefix}${clean}`;
            const altKey = `${prefix === 'sh' ? 'sz' : 'sh'}${clean}`;
            const found = parsed[key] || parsed[altKey];
            if (found) result[stock.code] = { ...found, code: stock.code };
        }
    }
    return result;
}

/**
 * 批量获取资产名称（1个HTTP请求，走服务端名称缓存）
 * @param {Array<{code: string, type: 'stock'|'fund'}>} items
 * @returns {Object} { '600036': '招商银行', '012831': '南方中证新能源ETF联接A', ... }
 */
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
        console.error('[API] fetchBulkNames failed:', e.message);
        return {};
    }
}

/**
 * 获取分时行情数据 (Intraday Data)
 * 使用腾讯财经接口
 */
export async function fetchIntradayData(code, type) {
    const { prefix, clean } = resolveMarket(code);
    const finalCode = `${prefix}${clean}`;
    try {
        // 兼容股票与 ETF。注意：开放式基金可能不支持分时图，通常显示净值走势
        const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${finalCode}`;
        const res = await fetchWithProxy(url);
        if (!res.ok) return null;

        const json = await res.json();
        const data = json.data?.[finalCode];
        if (!data || !data.qt?.[finalCode]) return null;

        const qt = data.qt[finalCode];
        const prevClose = parseFloat(qt[4]); // 昨收价
        const minuteData = data.data?.data || [];

        // 格式转换: "0930 10.50 100" -> { time: "09:30", value: 10.5, volume: 100 }
        const points = minuteData.map(item => {
            const parts = item.split(' ');
            const t = parts[0];
            return {
                time: `${t.substring(0, 2)}:${t.substring(2, 4)}`,
                value: parseFloat(parts[1]),
                volume: parseInt(parts[2])
            };
        });

        return {
            code,
            name: qt[1],
            price: parseFloat(qt[3]),
            changePercent: parseFloat(qt[32]),
            prevClose,
            points
        };
    } catch (e) {
        console.error(`[API] fetchIntradayData failed for ${code}:`, e.message);
        return null;
    }
}
