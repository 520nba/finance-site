/**
 * lib/services/marketParsers.js
 *
 * 外部行情源响应的**纯解析层**。
 *
 * 设计目的：
 *   1. 把「怎么解析」与「怎么抓取」拆开，解析函数全部可以在 Node 下离线单测
 *      （tests/marketParsers.test.mjs），不必起 Worker 或连外网；
 *   2. 多源回退时每个源一份解析，避免把解析逻辑散落在 service 里。
 *
 * 约定：本文件只做字符串/JSON → 结构化数据，不做网络请求、不碰 D1。
 */

/**
 * 腾讯批量行情
 *   输入：v_sh601318="1~中国平安~601318~53.24~52.83~52.86~...~53.23~1~...";
 *   字段：3=现价 4=昨收 31=涨跌额 32=涨跌幅
 */
export function parseTencentQuotes(text) {
    const out = {};
    for (const line of String(text || '').split(';')) {
        const m = line.match(/v_([^=]+)="([^"]+)"/);
        if (!m) continue;
        const f = m[2].split('~');
        if (f.length < 33) continue;

        const code = m[1].toLowerCase();
        const price = parseFloat(f[3]) || 0;
        const prevClose = parseFloat(f[4]) || 0;
        out[code] = {
            name: f[1] || code,
            code,
            price,
            change: parseFloat(f[31]) || 0,
            changePercent: parseFloat(f[32]) || 0,
            prevClose
        };
    }
    return out;
}

/**
 * 新浪行情（兜底源）
 *   输入：var hq_str_sh601318="中国平安,52.830,52.860,53.240,53.300,52.800,...";
 *   字段：0=名称 1=今开 2=昨收 3=现价
 *   注意：新浪该接口要求 Referer，且在 CF 出口是否可用需实测（见 sentinel 探针）
 */
export function parseSinaQuotes(text) {
    const out = {};
    const re = /hq_str_([a-zA-Z]{2}\d{6})="([^"]*)"/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const code = m[1].toLowerCase();
        const f = m[2].split(',');
        if (f.length < 4) continue;

        const name = String(f[0] || '').trim();
        const prevClose = parseFloat(f[2]) || 0;
        const price = parseFloat(f[3]) || 0;
        if (!(price > 0)) continue;

        out[code] = {
            name: name || code,
            code,
            price,
            change: prevClose > 0 ? Number((price - prevClose).toFixed(3)) : 0,
            changePercent: prevClose > 0 ? Number(((price / prevClose - 1) * 100).toFixed(2)) : 0,
            prevClose
        };
    }
    return out;
}

/**
 * 腾讯股票名称
 *   输入：v_sh600519="1~贵州茅台~600519~...";
 */
export function parseTencentStockName(text) {
    const m = String(text || '').match(/="([^"]+)"/);
    if (!m) return null;
    const name = m[1].split('~')[1]?.trim();
    return name || null;
}

/**
 * 天天基金 lsjz 历史净值（JSON，源为按日期倒序）
 *   输入：{"Data":[{"FSRQ":"2026-10-09","DWJZ":"1.8301"},...]}
 *   输出：按日期升序的 [{date, value}]
 */
export function parseFundLsjz(json) {
    const rows = json?.Data;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
        .map(r => ({ date: r?.FSRQ, value: parseFloat(r?.DWJZ) }))
        .filter(p => p.date && p.value > 0)
        .reverse();
}

/**
 * 天天基金 pingzhongdata JS 里的净值序列
 *   输入：...var Data_ACWorthTrend = [[ts,val],...]; ...（FOF 为 Data_netWorthTrend）
 *   输出：原始 [{ts, val}]，时间戳转换交给调用方（便于单测）
 */
export function parseFundPingzhongJs(text) {
    const s = String(text || '');
    const m = s.match(/var Data_ACWorthTrend = (\[\[.*?\]\]|\[\{.*?\}\]);/)
        || s.match(/var Data_netWorthTrend = (\[\[.*?\]\]|\[\{.*?\}\]);/);
    if (!m?.[1]) return null;

    let raw;
    try {
        raw = JSON.parse(m[1]);
    } catch {
        return null;
    }
    if (!Array.isArray(raw)) return null;

    return raw
        .map(item => {
            if (Array.isArray(item)) return { ts: item[0], val: item[1] };
            if (item && typeof item === 'object') return { ts: item.x, val: item.y };
            return null;
        })
        .filter(Boolean);
}
