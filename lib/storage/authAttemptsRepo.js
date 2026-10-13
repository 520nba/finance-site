/**
 * lib/storage/authAttemptsRepo.js
 *
 * 登录失败计数与锁定的 D1 读写（策略在 lib/auth/lockout.js，纯函数已单测）。
 * 读失败一律「不拦人」：宁可放行也不能因为统计表故障把用户锁在外面。
 */

import { queryOne, runSql, getRequiredDb } from './d1Client';
import { evaluateAttempts, lockDurationMs } from '@/lib/auth/lockout';

const PURGE_AFTER_MS = 24 * 3600 * 1000;

/**
 * 当前是否处于锁定状态
 * @returns {Promise<{ locked: boolean, retryAfterSec: number }>}
 */
export async function isLocked(key, env = null) {
    try {
        const row = await queryOne(
            'SELECT count, first_at_ms, locked_until_ms FROM auth_attempts WHERE key = ? LIMIT 1',
            [key],
            env
        );
        if (!row) return { locked: false, retryAfterSec: 0 };
        const st = evaluateAttempts({
            count: row.count,
            firstAtMs: row.first_at_ms,
            lockedUntilMs: row.locked_until_ms,
            nowMs: Date.now(),
        });
        return { locked: st.locked, retryAfterSec: st.retryAfterSec };
    } catch (e) {
        console.error('[AuthAttempts] isLocked failed:', e.message);
        return { locked: false, retryAfterSec: 0 };
    }
}

/**
 * 记录一次失败，必要时写入锁定时间
 * @returns {Promise<{ count: number, lockedMs: number }>}
 */
export async function registerFailure(key, env = null) {
    try {
        const db = await getRequiredDb(env);
        const now = Date.now();
        const row = await queryOne(
            'SELECT count, first_at_ms, locked_until_ms FROM auth_attempts WHERE key = ? LIMIT 1',
            [key],
            env
        );

        const st = evaluateAttempts({
            count: row?.count ?? 0,
            firstAtMs: row?.first_at_ms ?? null,
            lockedUntilMs: row?.locked_until_ms ?? null,
            nowMs: now,
        });

        const count = st.effectiveCount + 1;
        const firstAtMs = st.effectiveCount === 0 ? now : (row?.first_at_ms ?? now);
        const lockMs = lockDurationMs(count);
        const lockedUntilMs = lockMs > 0 ? now + lockMs : null;

        await db.prepare(`
            INSERT INTO auth_attempts (key, count, first_at_ms, locked_until_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                count = excluded.count,
                first_at_ms = excluded.first_at_ms,
                locked_until_ms = excluded.locked_until_ms,
                updated_at_ms = excluded.updated_at_ms
        `).bind(key, count, firstAtMs, lockedUntilMs, now).run();

        return { count, lockedMs: lockMs };
    } catch (e) {
        console.error('[AuthAttempts] registerFailure failed:', e.message);
        return { count: 0, lockedMs: 0 };
    }
}

/**
 * 成功后清掉指定 key 的失败记录（只清用户名 key，IP 计数留着继续兜底）
 */
export async function clearAttempts(keys, env = null) {
    try {
        const db = await getRequiredDb(env);
        const stmts = (Array.isArray(keys) ? keys : [keys]).map(k =>
            db.prepare('DELETE FROM auth_attempts WHERE key = ?').bind(k)
        );
        if (stmts.length) await db.batch(stmts);
    } catch (e) {
        console.error('[AuthAttempts] clearAttempts failed:', e.message);
    }
}

/**
 * 清理过期记录（由每小时保留期任务调用）
 */
export async function purgeOldAttempts(db) {
    if (!db) return 0;
    try {
        const res = await db
            .prepare('DELETE FROM auth_attempts WHERE updated_at_ms < ?')
            .bind(Date.now() - PURGE_AFTER_MS)
            .run();
        return res?.meta?.changes || 0;
    } catch (e) {
        console.error('[AuthAttempts] purge failed:', e.message);
        return 0;
    }
}
