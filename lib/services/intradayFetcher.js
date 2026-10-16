/**
 * lib/services/intradayFetcher.js
 *
 * 分时（分钟线）行情抓取 —— 多源回退
 *
 *   主源：东方财富 push2.eastmoney.com/api/qt/stock/trends2/get
 *   备源：腾讯财经 web.ifzq.gtimg.cn/appstock/app/minute/query
 *
 * 背景：东方财富对 Cloudflare Worker 出口稳定返回 502（api_health 里
 *      `Intra: EastMoney (Trends)` 长期 0/20），导致分时曲线在盘中冻结。
 *      本模块把「抓取 + 解析」从业务层剥离，做成纯函数，便于离线单测。
 *
 * 约定：本文件不引用 D1 / @opennextjs，只依赖 fetch 与纯工具，
 *      因此可以用 `node --test` 之类的方式直接跑。
 */

import { EASTMONEY_HEADERS, TENCENT_HEADERS } from '../constants/headers.js';
import { parseStockCode } from '../utils/stockCode.js';
import { fetchWithRetry } from '../utils.js';
import { TIMEOUT } from '../constants/timeouts.js';

// 只保留 A 股连续竞价时段（含早盘集合竞价）内的点，过滤掉 15:00 之后
// 腾讯附带的盘后快照（15:01~15:30 快照会把曲线尾部拉平，也会白占存储）
const SESSION_START = '09:15';
const SESSION_END = '15:00';

const EASTMONEY_TIMEOUT = TIMEOUT.EASTMONEY_MS;
const TENCENT_TIMEOUT = TIMEOUT.TENCENT_MS;

/**
 * 归一化各种时间写法 → 'HH:MM'
 *   '2026-10-12 09:30' / '0930' / '9:30' / '09:30'
 */
export function toHHMM(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    const colon = s.match(/(\d{1,2}):(\d{2})/);
    if (colon) return `${colon[1].padStart(2, '0')}:${colon[2]}`;
    const compact = s.match(/^(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}:${compact[2]}`;
    return null;
}

function inSession(hhmm) {
    return hhmm >= SESSION_START && hhmm <= SESSION_END;
}

function normalizeDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    return null;
}

/**
 * 解析东方财富 trends2 响应
 * trends 行格式（fields2=f51..f58）：
 *   "2026-10-12 09:30,开盘,收盘,最高,最低,成交量,成交额,均价"
 */
export function parseEastmoneyTrends(json) {
    const d = json?.data;
    if (!d?.trends?.length) return null;

    const prevClose = parseFloat(d.preClose) || parseFloat(d.prePrice) || 0;
    const points = [];
    let date = null;

    for (const line of d.trends) {
        const parts = String(line).split(',');
        if (parts.length < 3) continue;
        const rawTime = parts[0];
        if (!date && rawTime.includes(' ')) date = normalizeDate(rawTime.split(' ')[0]);
        const time = toHHMM(rawTime);
        const value = parseFloat(parts[2]);
        if (!time || !(value > 0)) continue;
        points.push({ time, value });
    }

    if (!points.length) return null;
    return { points, prevClose, date };
}

/**
 * 解析腾讯分钟线响应
 * data[code].data.data = ["0930 52.86 3285 17364510.00", ...]  (时间 价格 累计量 累计额)
 * data[code].data.date = "20261012"
 * data[code].qt[code]  = 标准腾讯行情数组，索引 3=现价 4=昨收
 */
export function parseTencentMinute(json, code) {
    const node = json?.data?.[code];
    const rows = node?.data?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const qt = node?.qt?.[code];
    const prevClose = Array.isArray(qt) && qt.length > 4 ? (parseFloat(qt[4]) || 0) : 0;

    const points = [];
    for (const row of rows) {
        const parts = String(row).trim().split(/\s+/);
        if (parts.length < 2) continue;
        const time = toHHMM(parts[0]);
        const value = parseFloat(parts[1]);
        if (!time || !(value > 0) || !inSession(time)) continue;
        points.push({ time, value });
    }

    if (!points.length) return null;
    return { points, prevClose, date: normalizeDate(node?.data?.date) };
}

// ── 单源抓取 ────────────────────────────────────────────────────────────────

export async function fetchEastmoneyIntraday(code, signal) {
    const parsed = parseStockCode(code);
    if (!parsed) throw new Error('unsupported code');

    const params = new URLSearchParams({
        secid: `${parsed.market}.${parsed.clean}`,
        fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58'
    });
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?${params}`;

    const res = await fetchWithRetry(url, { headers: EASTMONEY_HEADERS, timeout: EASTMONEY_TIMEOUT }, 0, signal);
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 80)}`);

    let json;
    try {
        json = JSON.parse(body);
    } catch {
        throw new Error(`non-JSON body: ${body.slice(0, 80)}`);
    }

    const data = parseEastmoneyTrends(json);
    if (!data) throw new Error('empty trends');
    data.source = 'eastmoney';
    return data;
}

export async function fetchTencentIntraday(code, signal) {
    const c = String(code || '').toLowerCase();
    if (!/^(sh|sz)\d{6}$/.test(c)) throw new Error('unsupported code');

    const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${c}&_=${Date.now()}`;
    const res = await fetchWithRetry(url, { headers: TENCENT_HEADERS, timeout: TENCENT_TIMEOUT }, 0, signal);
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 80)}`);

    let json;
    try {
        json = JSON.parse(body);
    } catch {
        throw new Error(`non-JSON body: ${body.slice(0, 80)}`);
    }

    const data = parseTencentMinute(json, c);
    if (!data) throw new Error('empty minute data');
    data.source = 'tencent';
    return data;
}

// 源顺序：**腾讯优先**。
// 东方财富 push2 对 Cloudflare 出口长期稳定返回 502（api_health 里
// `Intra: EastMoney (Trends)` 长期 0/20），把它放在第一位等于每个代码
// 每次刷新都先白跑一次请求（还多占一份子请求配额）。腾讯 meanwhile 同时
// 提供分钟线 + 昨收，实测稳定，故作为主源；东财保留为兜底（万一腾讯挂了）。
const SOURCES = [
    { name: 'tencent', fn: fetchTencentIntraday },
    { name: 'eastmoney', fn: fetchEastmoneyIntraday }
];

/**
 * 按顺序尝试各数据源，返回第一个可用的快照。
 *
 * @param {string} code      带市场前缀的代码，如 sh601318
 * @param {AbortSignal|null} signal
 * @param {string|null} expectDate  期望交易日 'YYYY-MM-DD'；源返回的日期与之不符时视为脏数据丢弃
 * @returns {{data: object|null, errors: string[]}}
 */
export async function fetchIntradaySnapshot(code, signal = null, expectDate = null) {
    const errors = [];

    for (const { name, fn } of SOURCES) {
        try {
            const data = await fn(code, signal);
            if (!data?.points?.length) {
                errors.push(`${name}: empty`);
                continue;
            }
            // 跨日脏数据保护：源明确给出日期且与预期不符时，绝不写入当日
            if (expectDate && data.date && data.date !== expectDate) {
                errors.push(`${name}: stale date ${data.date} != ${expectDate}`);
                continue;
            }
            return { data, errors };
        } catch (e) {
            errors.push(`${name}: ${e.message}`);
        }
    }

    return { data: null, errors };
}
