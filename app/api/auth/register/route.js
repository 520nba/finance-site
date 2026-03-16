/**
 * app/api/auth/register/route.js
 * 
 * 用户注册接口
 */

import { NextResponse } from 'next/server';
import { getRequiredDb } from '@/lib/storage/d1Client';
import { hashPassword, generateToken } from '@/lib/auth';

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

        const db = await getRequiredDb();

        // 1. 检查冲突
        const existing = await db.prepare('SELECT id FROM users WHERE id = ?')
            .bind(username.toLowerCase()).first();
        if (existing) {
            return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
        }

        // 2. 准备数据
        const hash = await hashPassword(password);
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

        // 3. 原子写入
        await db.batch([
            db.prepare('INSERT INTO users (id, password_hash) VALUES (?, ?)').bind(username.toLowerCase(), hash),
            db.prepare('INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
                .bind(token, username.toLowerCase(), expiresAt)
        ]);

        // 4. 返回并设置 Cookie
        const res = NextResponse.json({ success: true, userId: username.toLowerCase() });
        res.cookies.set('session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 3600,
            path: '/'
        });

        return res;
    } catch (e) {
        console.error('[Auth:Register] Error:', e.message);
        return NextResponse.json({ error: 'Server error during registration' }, { status: 500 });
    }
}
