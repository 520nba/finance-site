import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/storage/authRepo';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 目前系统暂未实现持久化队列，仅返回空结构以维持 UI 稳定
    return NextResponse.json({
        queue: [],
        count: 0,
        status: 'idle'
    });
}
