/**
 * app/api/auth/register/route.js
 * 
 * 用户注册接口
 */

import { NextResponse } from 'next/server';
import { isUsernameTaken, registerUser, SESSION_COOKIE_OPTIONS } from '@/lib/storage/authRepo';

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

        if (await isUsernameTaken(username)) {
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
