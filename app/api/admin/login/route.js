import { NextResponse } from 'next/server';
import { getKvStorage, writeDoc } from '@/lib/storage/kvClient';

export async function POST(request) {
    try {
        const { password } = await request.json();
        const envKey = process.env.ADMIN_API_KEY;

        if (!envKey) {
            return NextResponse.json({ success: false, error: 'ADMIN_API_KEY not configured' }, { status: 500 });
        }

        if (password !== envKey) {
            return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
        }

        // 创建短路 Session (1小时有效)
        const sessionToken = crypto.randomUUID();
        const expiresAt = Date.now() + 3600 * 1000;

        await writeDoc(`session:${sessionToken}`, {
            createdAt: Date.now(),
            expiresAt
        });

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
