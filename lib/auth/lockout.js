/**
 * lib/auth/lockout.js
 *
 * 登录失败的锁定策略（纯函数，便于单测）。
 *
 * 策略：
 *   - 15 分钟窗口内连续失败 5 次 → 锁定 15 分钟
 *   - 之后每再失败 5 次，锁定时长翻倍，上限 24 小时
 *   - 窗口过期或上一次锁定到期后，计数归零（重新给机会）
 *
 * 说明：这里只做「时间与计数」的纯计算，读写 D1 在
 * lib/storage/authAttemptsRepo.js 里完成 —— 分开是为了能离线单测。
 */

export const MAX_FAILS = 5;                    // 触发锁定的失败次数
export const WINDOW_MS = 15 * 60 * 1000;       // 计数窗口 15 分钟
export const BASE_LOCK_MS = 15 * 60 * 1000;    // 首次锁定 15 分钟
export const MAX_LOCK_MS = 24 * 3600 * 1000;   // 锁定上限 24 小时

/**
 * 评估当前状态
 * @param {{ count?: number, firstAtMs?: number|null, lockedUntilMs?: number|null, nowMs: number }} s
 * @returns {{ locked: boolean, retryAfterSec: number, effectiveCount: number }}
 */
export function evaluateAttempts({ count = 0, firstAtMs = null, lockedUntilMs = null, nowMs }) {
    // 1. 仍在锁定期内
    if (lockedUntilMs && lockedUntilMs > nowMs) {
        return {
            locked: true,
            retryAfterSec: Math.ceil((lockedUntilMs - nowMs) / 1000),
            effectiveCount: count,
        };
    }

    // 2. 锁定已过期，或从未锁定：看计数窗口是否还有效
    const windowAlive = firstAtMs != null && (nowMs - firstAtMs) < WINDOW_MS;
    if (lockedUntilMs && lockedUntilMs <= nowMs) {
        // 锁定期刚过 → 计数清零（否则用户永远出不来）
        return { locked: false, retryAfterSec: 0, effectiveCount: 0 };
    }

    return { locked: false, retryAfterSec: 0, effectiveCount: windowAlive ? count : 0 };
}

/**
 * 第 count 次失败后应锁多久（毫秒）；0 表示不锁
 */
export function lockDurationMs(count) {
    if (count < MAX_FAILS) return 0;
    const steps = Math.floor(count / MAX_FAILS); // 1,2,3,...
    return Math.min(BASE_LOCK_MS * Math.pow(2, steps - 1), MAX_LOCK_MS);
}
