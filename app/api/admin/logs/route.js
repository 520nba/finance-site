import { NextResponse } from 'next/server';
import { getSystemLogs } from '@/lib/storage/logRepo';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '72');

    // 简单的鉴权检查 (可以根据你的 admin 登录逻辑集成)
    // 这里假设 admin session 已通过 cookie 或 header 处理

    try {
        const logs = await getSystemLogs(hours);
        return NextResponse.json({ success: true, logs });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
