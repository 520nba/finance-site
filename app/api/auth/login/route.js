/**
 * app/api/auth/login/route.js
 * 
 * 用户登录接口
 */

import { NextResponse } from 'next/server';
import { loginUser, SESSION_COOKIE_OPTIONS } from '@/lib/storage/authRepo';

export async function POST(request) {
    try {
        const { username, password } = await request.json();
        if (!username || !password) {
            return NextResponse.json({ error: 'Credentials required' }, { status: 400 });
        }

        const result = await loginUser(username, password);
        if (!result) {
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }

        const res = NextResponse.json({ success: true, userId: result.userId });
        res.cookies.set('session', result.token, SESSION_COOKIE_OPTIONS);

        return res;
    } catch (e) {
        console.error('[Auth:Login] Error:', e.message);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}
