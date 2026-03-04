/**
 * 股票与基金数据获取接口封装 (全站升级为东方财富 UTF-8 数据源)
 */

// ── 网络层 ──────────────────────────────────────────


// ── 实时行情 ──────────────────────────────────────────

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
