import { fetchWithRetry, getBeijingTodayStr, isMarketClosedBeijing, formatDateInTimezone } from '../utils.js';
import { EASTMONEY_FUND_HEADERS } from '../constants/headers.js';
import { parseStockCode } from '../utils/stockCode.js';
import { parseFundLsjz, parseFundPingzhongJs } from './marketParsers.js';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*'
}

/**
 * 统一 Schema 校验与归一化
 */
function normalizePoints(points) {
    if (!Array.isArray(points)) return [];
    return points
        .map(p => ({
            date: String(p.date),
            value: parseFloat(p.value)
        }))
        .filter(p => p.date && !isNaN(p.value) && p.value > 0);
}

/**
 * 只保留「已收盘数据」：盘中丢弃当日未完成 K 线，收盘后保留当日。
 */
function trimBySession(points, days) {
    const today = getBeijingTodayStr();
    const closed = isMarketClosedBeijing();
    return normalizePoints(points)
        .filter(i => (closed ? i.date <= today : i.date < today))
        .slice(-days);
}

// ── 内部实现（失败即抛错，便于上层记录「哪个源、什么原因」失败）──────────────

async function _eastmoneyStock(code, days, signal) {
    const parsed = parseStockCode(code);
    if (!parsed) throw new Error('unsupported code');

    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${parsed.market}.${parsed.clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 10}`;
    const res = await fetchWithRetry(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://quote.eastmoney.com/' } }, 0, signal);
    if (!res) throw new Error('no response');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const d = await res.json();
    if (!d?.data?.klines) throw new Error('empty klines');

    const points = d.data.klines.slice(-(days + 20)).map(line => {
        const p = line.split(',')
        return { date: p[0], value: parseFloat(p[1]) }
    });

    const data = trimBySession(points, days);
    if (!data.length) throw new Error('no points after session filter');
    return data;
}

async function _tencentStock(code, days, signal) {
    const year = new Date().getFullYear() + 2
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${code.toLowerCase()},day,2020-01-01,${year}-12-31,500,qfq`
    const res = await fetchWithRetry(url, { headers: BASE_HEADERS }, 0, signal)
    if (!res) throw new Error('no response');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text()
    // 该接口是 JSONP 风格：可能带 `_var=` 前缀与结尾分号，直接 JSON.parse 会炸
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('malformed kline payload')
    const d = JSON.parse(text.slice(start, end + 1))
    const stockData = d.data?.[code.toLowerCase()]
    const kline = stockData?.qfqday || stockData?.day
    if (!kline || !Array.isArray(kline)) throw new Error(`no kline (${d?.msg || 'unknown'})`);

    const points = kline.slice(-(days + 50)).map(item => ({ date: item[0], value: parseFloat(item[2]) }))
    const data = trimBySession(points, days);
    if (!data.length) throw new Error('no points after session filter');
    return data;
}

async function _sinaStock(code, days, signal) {
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${days}`
    const res = await fetchWithRetry(url, {}, 0, signal)
    if (!res) throw new Error('no response');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const d = await res.json()
    if (!Array.isArray(d)) throw new Error('malformed payload');

    const points = d.map(i => ({ date: i.day.split(' ')[0], value: parseFloat(i.close) }));
    const data = trimBySession(points, days);
    if (!data.length) throw new Error('no points after session filter');
    return data;
}

function _fundCode(code) {
    const match = String(code).match(/^([a-zA-Z]{2})?(\d+)$/i);
    return match ? match[2] : String(code);
}

async function _fundPingzhong(code, days, signal) {
    const clean = _fundCode(code);
    const url = `https://fund.eastmoney.com/pingzhongdata/${clean}.js`;
    const res = await fetchWithRetry(url, {
        headers: { ...BASE_HEADERS, 'Referer': 'https://fund.eastmoney.com/' }
    }, 0, signal);
    if (!res) throw new Error('no response');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const raw = parseFundPingzhongJs(await res.text());
    if (!raw || raw.length === 0) throw new Error('net worth series not found');

    // 先切片再格式化，避免在几千个点上反复创建 Intl formatter
    const points = raw.slice(-(days + 60))
        .filter(item => item.ts !== undefined && item.val !== undefined)
        .map(item => ({ date: formatDateInTimezone(item.ts, "Asia/Shanghai"), value: parseFloat(item.val) }));

    const data = trimBySession(points, days);
    if (!data.length) throw new Error('no points after session filter');
    return data;
}

async function _fundLsjz(code, days, signal) {
    const clean = _fundCode(code);
    const pageSize = Math.min(Math.max(days, 1), 200);
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=${pageSize}&_=${Date.now()}`;
    const res = await fetchWithRetry(url, { headers: EASTMONEY_FUND_HEADERS }, 0, signal);
    if (!res) throw new Error('no response');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = trimBySession(parseFundLsjz(await res.json()), days);
    if (!data.length) throw new Error('empty lsjz payload');
    return data;
}

// ── 单源公开接口（失败返回 null，供 sentinel 探针使用）────────────────────────

async function _safe(fn, ...args) {
    try {
        return await fn(...args);
    } catch {
        return null;
    }
}

export const fetchStockEastmoney = (code, days, signal = null) => _safe(_eastmoneyStock, code, days, signal);
export const fetchStockTencent = (code, days, signal = null) => _safe(_tencentStock, code, days, signal);
export const fetchStockSina = (code, days, signal = null) => _safe(_sinaStock, code, days, signal);
export const fetchFundPingzhong = (code, days, signal = null) => _safe(_fundPingzhong, code, days, signal);
export const fetchFundLsjz = (code, days, signal = null) => _safe(_fundLsjz, code, days, signal);

// ── 多源回退 ────────────────────────────────────────────────────────────────

const STOCK_SOURCES = [
    ['eastmoney', _eastmoneyStock],
    ['tencent', _tencentStock],
    ['sina', _sinaStock]
];

const FUND_SOURCES = [
    ['eastmoney-pingzhong', _fundPingzhong],
    ['eastmoney-lsjz', _fundLsjz]
];

/**
 * 多源回退（按**新鲜度**择优，而不是「拿到非空就停」）
 *
 * 为什么不能只看非空：实测腾讯前复权序列对部分标的当天还没更新
 * （例如 sh600900 返回 …2026-10-09，而新浪已经是 2026-10-12）。
 * 若第一个源返回了非空的陈旧数据就短路，后面的源永远不会被用到。
 *
 * 策略：
 *   - 逐个源取数，记录各自的最后交易日，保留最新的那个；
 *   - 一旦某个源已经达到 expectDate（当日）就提前结束，省掉后续外呼；
 *   - attempts 记录每个源的情况（失败原因 / 比当前最优更旧），供任务留痕。
 */
async function _fetchWithFallback(code, days, signal, sources, expectDate = getBeijingTodayStr()) {
    const attempts = [];
    let best = null;

    for (const [source, fn] of sources) {
        try {
            const points = await fn(code, days, signal);
            if (!points?.length) {
                attempts.push({ source, error: 'empty result' });
                continue;
            }

            const latest = points[points.length - 1].date;
            if (!best) {
                best = { points, source, latest };
            } else if (latest > best.latest) {
                attempts.push({ source: best.source, error: `stale (latest ${best.latest})` });
                best = { points, source, latest };
            } else {
                attempts.push({ source, error: `not newer than ${best.source} (latest ${latest})` });
            }

            if (expectDate && latest >= expectDate) break;
        } catch (e) {
            attempts.push({ source, error: e.message || 'failed' });
        }
    }

    return best
        ? { points: best.points, source: best.source, attempts }
        : { points: null, source: null, attempts };
}

/**
 * 股票历史（带来源与失败原因）
 * @returns {{points: Array|null, source: string|null, attempts: Array<{source,error}>}}
 */
export function fetchStockHistoryDetailed(code, days, signal = null) {
    return _fetchWithFallback(code, days, signal, STOCK_SOURCES);
}

/**
 * 基金历史（带来源与失败原因）：天天基金 pingzhongdata → 天天基金 lsjz 接口
 */
export function fetchFundHistoryDetailed(code, days, signal = null) {
    return _fetchWithFallback(code, days, signal, FUND_SOURCES);
}

/**
 * 股票历史（兼容旧签名，返回数组或 null）
 */
export async function fetchStockHistory(code, days, signal = null) {
    const { points, source } = await fetchStockHistoryDetailed(code, days, signal);
    if (points) console.log(`[Fetcher] Fetched ${points.length} points for stock ${code} via ${source}`);
    return points;
}

/**
 * 基金历史（兼容旧签名，返回数组或 null）
 */
export async function fetchFundHistory(code, days, signal = null) {
    const { points, source } = await fetchFundHistoryDetailed(code, days, signal);
    if (points) console.log(`[Fetcher] Fund ${code}: ${points.length} points via ${source}`);
    return points;
}
