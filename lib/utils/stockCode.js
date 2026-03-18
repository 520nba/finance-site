/**
 * lib/utils/stockCode.js
 * 
 * 股票代码解析工具库
 * 
 * 职责：
 * 1. 统一解析带市场前缀的代码 (如 sh600036, sz000001)。
 * 2. 构造东方财富 secid 格式 (market.cleanCode)。
 */

/**
 * 解析股票代码
 * 
 * @param {string} code 带前缀的代码，如 'sh600036', 'sz000001', 'SH600036'
 * @returns {{ market: '0'|'1', clean: string, prefix: 'sh'|'sz' } | null}
 */
export function parseStockCode(code) {
    if (!code || code.length !== 8) return null;
    const match = code.match(/^([a-zA-Z]{2})(\d{6})$/i);
    if (!match) return null;

    const prefix = match[1].toLowerCase();
    const clean = match[2];

    // 东方财富格式: 1 为上交所 (sh/bj), 0 为深交所 (sz)
    // 注意: 这里暂不处理北交所等更复杂的市场，目前项目主要涉及 sh/sz
    const market = (prefix === 'sz') ? '0' : '1';

    return { market, clean, prefix };
}

/**
 * 构造东方财富 secid
 * 
 * @param {string} code 代码
 * @returns {string|null} 如 '1.600036', '0.000001'
 */
export function toSecid(code) {
    const parsed = parseStockCode(code);
    if (!parsed) return null;
    return `${parsed.market}.${parsed.clean}`;
}
