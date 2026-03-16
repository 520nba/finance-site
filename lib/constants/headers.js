/**
 * lib/constants/headers.js
 * 
 * 统一请求头常量库
 * 
 * 职责：
 * 1. 集中管理所有外部数据源（东方财富、腾讯、天天基金等）的 HTTP Headers。
 * 2. 避免各处代码重复定义导致的不一致（如漏设 Referer）。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 东方财富行情接口 (历史数据、分时、名称查询、全站统计)
 */
export const EASTMONEY_HEADERS = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
};

/**
 * 东方财富天天基金 API 接口 (JSON 数据)
 */
export const EASTMONEY_FUND_HEADERS = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Referer': 'http://fundf10.eastmoney.com/'
};

/**
 * 东方财富天天基金 HTML/网页解析 (QDII 兜底抓取)
 */
export const EASTMONEY_FUND_HTML_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html',
    'Referer': 'http://fundf10.eastmoney.com/'
};

/**
 * 腾讯财经行情接口 (备用名称抓取)
 */
export const TENCENT_HEADERS = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Referer': 'https://gu.qq.com/'
};
