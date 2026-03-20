/**
 * lib/constants/tradingHours.js
 * 
 * A 股交易时段统一定义
 * 所有涉及交易时间判断的模块必须引用此文件，禁止硬编码
 */

// 连续交易时段 (HH:MM 格式)
export const TRADING_SESSIONS = [
    { open: '09:25', close: '11:35' }, // 早盘 (含开盘集合竞价，11:30后留5分钟数据缓冲)
    { open: '12:55', close: '15:05' }, // 午盘 (提前5分钟预热，延后5分钟收尾)
];

/**
 * 判断当前北京时间是否处于交易时段
 * @param {Date} bjDate 北京时间 Date 对象
 * @returns {boolean}
 */
export function isTradingHour(bjDate) {
    const h = bjDate.getHours();
    const m = bjDate.getMinutes();
    const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return TRADING_SESSIONS.some(s => hhmm >= s.open && hhmm <= s.close);
}

/**
 * 判断当前北京时间是否已过 A 股收盘 (15:15 后视为盘后确认完毕)
 * @param {Date} bjDate 北京时间 Date 对象
 * @returns {boolean}
 */
export function isMarketClosed(bjDate) {
    const hour = bjDate.getHours();
    const minute = bjDate.getMinutes();
    return (hour > 15) || (hour === 15 && minute >= 15);
}
