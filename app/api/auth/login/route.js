/**
 * app/api/auth/login/route.js
 * 
 * 用户登录接口
 */

import { NextResponse } from 'next/server';
import { getRequiredDb } from '@/lib/storage/d1Client';
import { verifyPassword, generateToken } from '@/lib/auth';

export async function POST(request) {
    try {
        const { username, password } = await request.json();
        if (!username || !password) {
            return NextResponse.json({ error: 'Credentials required' }, { status: 400 });
        }

        const db = await getRequiredDb();
        const user = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?')
            .bind(username.toLowerCase()).first();

        // 即使没有用户，也运行一次验证逻辑，增加时间消耗一致性以防时序探测
        // 使用一个真实格式且长度匹配的占位哈希
        const DUMMY_HASH = 'pbkdf2:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
        const isValid = user
            ? await verifyPassword(password, user.password_hash)
            : (await verifyPassword(password, DUMMY_HASH) && false);

        if (!isValid) {
            return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
        }

        // 生成新会话
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

        await db.prepare('INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
            .bind(token, user.id, expiresAt).run();

        const res = NextResponse.json({ success: true, userId: user.id });
        res.cookies.set('session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 3600,
            path: '/'
        });

        return res;
    } catch (e) {
        console.error('[Auth:Login] Error:', e.message);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}
