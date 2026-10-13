/**
 * tests/cronDispatch.test.mjs
 *
 * Cron 调度分发回归测试（离线，纯函数）
 *   node --test tests/cronDispatch.test.mjs
 *
 * 背景：免费版每账户只有 5 个 Cron Trigger，因此把 5 条表达式合并成 2 条，
 * 由 pickTasks() 按北京时间分发。调度写错会同时影响四类任务，必须单测覆盖。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { pickTasks, SENTINEL_CRON, TICK_CRON } from '../lib/cron/dispatch.js';
import { lastClosedTradingDateStr } from '../lib/utils.js';

// 这些 Date 直接当作「北京时间墙上时间」使用（pickTasks 只读 getDay/getHours/getMinutes）
const bj = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi, 0);

// 用到的日期（已核对星期）：2026-10-12 周一、10-13 周二、10-17 周六、10-18 周日

test('*/15 那条只跑健康巡检', () => {
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 9, 0), SENTINEL_CRON), ['sentinel']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 9, 7), SENTINEL_CRON), ['sentinel']);
    assert.deepEqual(pickTasks(bj(2026, 10, 18, 22, 45), SENTINEL_CRON), ['sentinel']);
});

test('每分钟都有队列处理器（含非交易时段）', () => {
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 3, 7), TICK_CRON), ['queue']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 20, 41), TICK_CRON), ['queue']);
    assert.deepEqual(pickTasks(bj(2026, 10, 18, 12, 30), TICK_CRON), ['queue']);
});

test('盘中分时投递：工作日 09:00-15:59、每 5 分钟（与合并前一致）', () => {
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 9, 0), TICK_CRON), ['queue', 'realtime']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 10, 35), TICK_CRON), ['queue', 'realtime']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 15, 55), TICK_CRON), ['queue', 'realtime']);
    // 不在 5 分钟网格上
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 10, 33), TICK_CRON), ['queue']);
    // 窗口外
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 8, 55), TICK_CRON), ['queue']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 16, 0), TICK_CRON), ['queue']);
    // 周末不投递
    assert.deepEqual(pickTasks(bj(2026, 10, 17, 10, 30), TICK_CRON), ['queue']);
});

test('22:15-22:29 窗口内全量历史（窗口化抗丢分钟，投递幂等）', () => {
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 22, 15), TICK_CRON), ['queue', 'history-full']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 22, 25), TICK_CRON), ['queue', 'history-full']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 22, 14), TICK_CRON), ['queue']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 22, 30), TICK_CRON), ['queue']);
    // 周六晚上不投递
    assert.deepEqual(pickTasks(bj(2026, 10, 17, 22, 15), TICK_CRON), ['queue']);
});

test('03:00-03:14 周二至周六只补落后资产', () => {
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 3, 0), TICK_CRON), ['queue', 'history-missing']);
    assert.deepEqual(pickTasks(bj(2026, 10, 17, 3, 10), TICK_CRON), ['queue', 'history-missing']);
    // 周日凌晨不跑（周六没有交易日）
    assert.deepEqual(pickTasks(bj(2026, 10, 18, 3, 0), TICK_CRON), ['queue']);
    // 03:3 不在网格、03:15 已出窗口
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 3, 3), TICK_CRON), ['queue']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 3, 15), TICK_CRON), ['queue']);
});

test('两类历史投递不会在同一分钟同时触发', () => {
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 22, 15), TICK_CRON), ['queue', 'history-full']);
    assert.deepEqual(pickTasks(bj(2026, 10, 13, 3, 0), TICK_CRON), ['queue', 'history-missing']);
});

test('lastClosedTradingDateStr：向前跳过周末', () => {
    assert.equal(lastClosedTradingDateStr(bj(2026, 10, 13, 3, 0)), '2026-10-12'); // 周二凌晨 → 周一
    assert.equal(lastClosedTradingDateStr(bj(2026, 10, 12, 3, 0)), '2026-10-09'); // 周一凌晨 → 上周五
    assert.equal(lastClosedTradingDateStr(bj(2026, 10, 17, 3, 0)), '2026-10-16'); // 周六凌晨 → 周五
    assert.equal(lastClosedTradingDateStr(bj(2026, 10, 18, 3, 0)), '2026-10-16'); // 周日凌晨 → 周五（跳两天）
});
