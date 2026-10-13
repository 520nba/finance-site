/**
 * app/api/auth/register/route.js
 * 
 * 用户注册接口
 *
 * 防滥用：注册不校验密码，因此这里只按 IP 计数（复用登录失败计数表），
 * 同一个 IP 连续注册/失败过多时返回 429，避免被批量刷账号。
 */

import { NextResponse } from 'next/server';
import { isUsernameTaken, registerUser, SESSION_COOKIE_OPTIONS } from '@/lib/storage/authRepo';
import { isLocked, registerFailure } from '@/lib/storage/authAttemptsRepo';

export async function POST(request) {
    try {
        const { username, password } = await request.json();

        // 格式校验
        if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
            return NextResponse.json({ error: 'Username must be 3-30 chars (letters/numbers/_/-)' }, { status: 400 });
        }

        if (!password || password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
        }

        const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
        const ipKey = `ip:${ip}`;
        const st = await isLocked(ipKey);
        if (st.locked) {
            return NextResponse.json(
                { error: 'Too many attempts. Try again later.', retryAfter: st.retryAfterSec },
                { status: 429, headers: { 'Retry-After': String(st.retryAfterSec) } }
            );
        }

        if (await isUsernameTaken(username)) {
            // 重复注册也算一次失败，挡住「扫用户名」的行为
            await registerFailure(ipKey);
            return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
        }

        const { userId, token } = await registerUser(username, password);

        const res = NextResponse.json({ success: true, userId });
        res.cookies.set('session', token, SESSION_COOKIE_OPTIONS);

        return res;
    } catch (e) {
        console.error('[Auth:Register] Error:', e);
        return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
    }
}
