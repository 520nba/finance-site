import { NextResponse } from 'next/server';
import { runSql, getCloudflareCtx } from '@/lib/storage/d1Client';

export async function POST(request) {
    try {
        const { password } = await request.json();

        // 获取环境变量密钥：先查 process.env，再查 Cloudflare context
        let envKey = process.env.ADMIN_API_KEY;
        if (!envKey) {
            try {
                const ctx = await getCloudflareCtx();
                envKey = ctx?.env?.ADMIN_API_KEY;
            } catch (e) {
                console.error('[Login] Fail to get env from context:', e.message);
            }
        }

        if (!envKey) {
            return NextResponse.json({ success: false, error: 'ADMIN_API_KEY not configured' }, { status: 500 });
        }

        // 增加 trim 容错
        if (password?.trim() !== envKey.trim()) {
            return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
        }

        // 创建短路 Session (1小时有效，存入 D1)
        const sessionToken = crypto.randomUUID();
        const expiresAt = Date.now() + 3600 * 1000;

        await runSql(
            'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)',
            [sessionToken, expiresAt]
        );

        return NextResponse.json({
            success: true,
            data: {
                token: sessionToken,
                expiresAt
            }
        });

    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
