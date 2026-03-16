/**
 * src/lib/services/quoteFetcher.js
 *
 * 盘中实时行情抓取，供 realtimeSync.js 调用。
 *
 * 数据源：
 *   股票主源  腾讯财经  qt.gtimg.cn
 *   股票备源  东方财富  push2.eastmoney.com
 *   基金      东方财富天天基金估值  fundgz.1234567.com.cn
 *
 * 返回格式（统一）：
 *   {
 *     code:      string,   // 原始 code，如 "sh600036" / "110020"
 *     type:      string,   // "stock" | "fund"
 *     price:     number,   // 当前价 / 估算净值
 *     changePct: number,   // 涨跌幅（百分比，如 1.23 表示 +1.23%）
 *     time:      string,   // 行情时间，"HH:MM" 格式（用于 asset_intraday_points.time）
 *     vol:       number,   // 成交量（手）；基金为 0
 *   }
 */

const TENCENT_HEADERS   = { Referer: 'https://gu.qq.com/' };
const EASTMONEY_HEADERS = { Referer: 'https://quote.eastmoney.com/' };

// ── 公开接口 ─────────────────────────────────────────────────────────────────

/**
 * 抓取单支股票实时行情。主源腾讯，失败后切东方财富。
 * AbortError（超时）直接向上抛，不尝试备源。
 *
 * @param {string}      code    带市场前缀，如 "sh600036" / "sz000001"
 * @param {AbortSignal} signal
 * @returns {Promise<QuoteResult>}
 */
export async function fetchStockQuote(code, signal) {
    try {
        return await _tencentStock(code, signal);
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        console.warn(`[QuoteFetcher] Tencent failed for ${code}, fallback EastMoney: ${e.message}`);
        return await _eastmoneyStock(code, signal);
    }
}

/**
 * 抓取单只基金当日估算净值（东方财富，约每 15 分钟更新）。
 *
 * @param {string}      code    纯数字代码，如 "110020"
 * @param {AbortSignal} signal
 * @returns {Promise<QuoteResult>}
 */
export async function fetchFundQuote(code, signal) {
    // JSONP 格式：jsonpgz({"fundcode":"110020","gsz":"1.5230","gszzl":"0.23","gztime":"15:00",...});
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const res = await fetch(url, {
        headers: { Referer: 'https://fund.eastmoney.com/' },
        signal,
    });
    if (!res.ok) throw new Error(`Fund quote HTTP ${res.status} for ${code}`);

    const text  = await res.text();
    const match = text.match(/jsonpgz\((\{.*?\})\)/);
    if (!match) throw new Error(`Fund quote parse failed for ${code}: ${text.slice(0, 60)}`);

    const d         = JSON.parse(match[1]);
    const price     = parseFloat(d.gsz)   || 0;
    const changePct = parseFloat(d.gszzl) || 0;
    // gztime 格式 "15:00"，无日期部分，直接使用
    const time      = d.gztime ?? currentBjHHMM();

    return { code, type: 'fund', price, changePct, time, vol: 0 };
}

// ── 私有：腾讯股票 ────────────────────────────────────────────────────────────

async function _tencentStock(code, signal) {
    const res = await fetch(`https://qt.gtimg.cn/q=${code}`, {
        headers: TENCENT_HEADERS,
        signal,
    });
    if (!res.ok) throw new Error(`Tencent HTTP ${res.status}`);

    const text  = await res.text();
    // 格式：v_sh600036="1~招商银行~600036~41.50~41.20~...~vol~amount~...~20240318150000~..."
    const inner = text.match(/="([^"]+)"/)?.[1];
    if (!inner) throw new Error(`Tencent parse failed: ${text.slice(0, 60)}`);

    const parts = inner.split('~');
    if (parts.length < 37) throw new Error(`Tencent fields only ${parts.length}`);

    const price     = parseFloat(parts[3])  || 0;
    const prevClose = parseFloat(parts[4])  || 0;
    const changePct = prevClose
        ? parseFloat((((price - prevClose) / prevClose) * 100).toFixed(2))
        : 0;
    const vol  = parseInt(parts[36], 10) || 0;
    // parts[30] 行情时间 "20240318150000" → "15:00"
    const raw  = parts[30] ?? '';
    const time = raw.length === 14
        ? `${raw.slice(8, 10)}:${raw.slice(10, 12)}`
        : currentBjHHMM();

    return { code, type: 'stock', price, changePct, time, vol };
}

// ── 私有：东方财富股票（备源）────────────────────────────────────────────────

async function _eastmoneyStock(code, signal) {
    const market   = code.startsWith('sh') ? '1' : '0';
    const pureCode = code.replace(/^(sh|sz)/, '');
    const url      = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${pureCode}&fields=f43,f46,f47,f170,f86`;

    const res = await fetch(url, { headers: EASTMONEY_HEADERS, signal });
    if (!res.ok) throw new Error(`EastMoney HTTP ${res.status}`);

    const d = (await res.json())?.data;
    if (!d) throw new Error(`EastMoney empty data for ${code}`);

    // f43 现价×100，f170 涨跌幅×100，f47 成交量（手），f86 Unix 秒时间戳
    const price     = (d.f43  ?? 0) / 100;
    const changePct = (d.f170 ?? 0) / 100;
    const vol       = d.f47 ?? 0;
    const time      = d.f86
        ? new Date(d.f86 * 1000).toLocaleTimeString('zh-CN', {
              timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
          })
        : currentBjHHMM();

    return { code, type: 'stock', price, changePct, time, vol };
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function currentBjHHMM() {
    return new Date().toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
    });
}
