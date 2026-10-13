/**
 * lib/cron/dispatch.js
 *
 * 纯函数：根据「触发它的 cron 表达式」+「北京时间」决定这一趟跑哪些任务。
 *
 * 背景：免费版 **每个账户** 只有 5 个 Cron Trigger（官方实测报错 10072：
 * "This account has reached the Workers Free limit of 5 cron triggers per account"），
 * 原来 5 条表达式被这一个 Worker 占满，账户下其他 Worker 一个名额都没有。
 *
 * 因此把 5 条调度合并为 2 条（下面用 *\/ 转义，避免提前闭合块注释）：
 *   *\/1  * * * *   每分钟：队列处理器 + 按北京时间分发（盘中分时 / 22:15 全量历史 / 03:00 补缺）
 *   *\/15 * * * *   每 15 分钟：健康巡检（独立一趟，避免与队列那一趟争抢单次外呼额度）
 *
 * 抽成纯函数是为了能单测：调度逻辑写错会同时影响四类任务，不能靠线上观察兜底。
 */

export const SENTINEL_CRON = '*/15 * * * *';
export const TICK_CRON = '*/1 * * * *';

/** 时间窗口用 5 分钟网格，避免某一分钟被跳过就整天漏跑；投递本身幂等，重复跑无害 */
function onGrid(minute) {
    return minute % 5 === 0;
}

/**
 * @param {Date} bjDate  北京时间（由 getBeijingDate() 得到）
 * @param {string} cron  触发本次调用的事件表达式（event.cron）
 * @returns {string[]}   本次要执行的任务名
 */
export function pickTasks(bjDate, cron) {
    // 巡检单独一趟
    if (cron === SENTINEL_CRON) return ['sentinel'];

    const dow = bjDate.getDay(); // 0=周日 6=周六
    const hour = bjDate.getHours();
    const minute = bjDate.getMinutes();

    const tasks = ['queue']; // 每分钟：队列处理器

    // 盘中分时投递：工作日 09:00–15:59，每 5 分钟（与合并前 *\/5 1-7 * * 2-6 完全一致）
    if (dow >= 1 && dow <= 5 && hour >= 9 && hour < 16 && onGrid(minute)) {
        tasks.push('realtime');
    }

    // 全量历史投递：工作日 22:15–22:29（对应原 15 14 * * 2-6）
    if (dow >= 1 && dow <= 5 && hour === 22 && minute >= 15 && minute < 30 && onGrid(minute)) {
        tasks.push('history-full');
    }

    // 补缺投放：周二至周六 03:00–03:14（对应原 0 19 * * 2-7 = 北京次日 03:00）
    // 只投递「落后于最近一个交易日」的资产：覆盖晚发布的基金净值 + 上一趟失败的资产，
    // 不再像原来那样把 51 只全部重跑一遍。
    if (dow >= 2 && dow <= 6 && hour === 3 && minute < 15 && onGrid(minute)) {
        tasks.push('history-missing');
    }

    return tasks;
}
