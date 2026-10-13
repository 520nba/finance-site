/**
 * app/api/auth/login/route.js
 * 
 * 用户登录接口
 *
 * 防爆破：此前这里可以无限次尝试密码（全仓库无任何限流）。现在按
 * 「IP」与「用户名」双键计数，15 分钟内失败 5 次即锁定 15 分钟，
 * 之后每再失败 5 次锁定时长翻倍（上限 24 小时）。策略见 lib/auth/lockout.js。
 */

import { NextResponse } from 'next/server';
import { loginUser, SESSION_COOKIE_OPTIONS } from '@/lib/storage/authRepo';
import { isLocked, registerFailure, clearAttempts } from '@/lib/storage/authAttemptsRepo';

/** 取客户端 IP：Cloudflare 会带上 cf-connecting-ip */
function clientIp(request) {
    return request.headers.get('cf-connecting-ip')
        || request.headers.get('x-real-ip')
        || 'unknown';
}

export async function POST(request) {
    try {
        const { username, password } = await request.json();
        if (!username || !password) {
            return NextResponse.json({ error: 'Credentials required' }, { status: 400 });
        }

        // ── 防爆破闸：IP 与用户名分别计数 ──────────────────────────────
        const ipKey = `ip:${clientIp(request)}`;
        const userKey = `user:${String(username).toLowerCase()}`;

        for (const key of [ipKey, userKey]) {
            const st = await isLocked(key);
            if (st.locked) {
                return NextResponse.json(
                    { error: 'Too many failed attempts. Try again later.', retryAfter: st.retryAfterSec },
                    { status: 429, headers: { 'Retry-After': String(st.retryAfterSec) } }
                );
            }
        }

        const result = await loginUser(username, password);
        if (!result) {
            // 失败：两个键都记一笔（IP 计数不清空，用于挡住换用户名的爆破）
            await registerFailure(ipKey);
            await registerFailure(userKey);
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }

        // 成功：只清用户名键，IP 计数留着继续兜底
        await clearAttempts([userKey]);

        const res = NextResponse.json({ success: true, userId: result.userId });
        res.cookies.set('session', result.token, SESSION_COOKIE_OPTIONS);

        return res;
    } catch (e) {
        console.error('[Auth:Login] Error:', e.message);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}
