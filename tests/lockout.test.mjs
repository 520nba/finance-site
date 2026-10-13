/**
 * tests/lockout.test.mjs
 *
 * 登录锁定策略的纯函数测试（离线）
 *   node --test tests/lockout.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAttempts, lockDurationMs, MAX_FAILS, WINDOW_MS, BASE_LOCK_MS, MAX_LOCK_MS } from '../lib/auth/lockout.js';

const T0 = 1_800_000_000_000; // 任意基准时刻

test('未失败过：不锁', () => {
    const st = evaluateAttempts({ count: 0, firstAtMs: null, lockedUntilMs: null, nowMs: T0 });
    assert.equal(st.locked, false);
    assert.equal(st.effectiveCount, 0);
});

test('窗口内累计失败：计数保留', () => {
    const st = evaluateAttempts({ count: 3, firstAtMs: T0, lockedUntilMs: null, nowMs: T0 + 60_000 });
    assert.equal(st.locked, false);
    assert.equal(st.effectiveCount, 3);
});

test('窗口过期：计数归零（重新给机会）', () => {
    const st = evaluateAttempts({ count: 4, firstAtMs: T0, lockedUntilMs: null, nowMs: T0 + WINDOW_MS + 1 });
    assert.equal(st.effectiveCount, 0);
});

test('锁定期内：locked 且给出 retryAfterSec', () => {
    const st = evaluateAttempts({ count: 5, firstAtMs: T0, lockedUntilMs: T0 + 600_000, nowMs: T0 + 60_000 });
    assert.equal(st.locked, true);
    assert.equal(st.retryAfterSec, 540);
});

test('锁定期刚过：解锁且计数清零（否则用户永远出不来）', () => {
    const st = evaluateAttempts({ count: 5, firstAtMs: T0, lockedUntilMs: T0 + 600_000, nowMs: T0 + 600_001 });
    assert.equal(st.locked, false);
    assert.equal(st.effectiveCount, 0);
});

test('锁定时长：5 次以内不锁，5 次锁 15 分钟，10 次翻倍，上限 24 小时', () => {
    assert.equal(lockDurationMs(MAX_FAILS - 1), 0);
    assert.equal(lockDurationMs(MAX_FAILS), BASE_LOCK_MS);
    assert.equal(lockDurationMs(MAX_FAILS * 2), BASE_LOCK_MS * 2);
    assert.equal(lockDurationMs(MAX_FAILS * 3), BASE_LOCK_MS * 4);
    assert.equal(lockDurationMs(MAX_FAILS * 1000), MAX_LOCK_MS);
});
