import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryAll } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

/**
 * 管理后台：同步队列清单接口
 */
export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // 获取队列中所有未完成的任务，按创建时间倒序
        // 限制 100 条防止响应过大，管理员可以以后增加分页
        const sql = `
            SELECT code, type, status, created_at, updated_at 
            FROM sync_queue 
            ORDER BY created_at DESC 
            LIMIT 100
        `;
        const queue = await queryAll(sql);

        return NextResponse.json({
            queue: queue || []
        });
    } catch (e) {
        console.error('[AdminQueue] Failure:', e.message);
        return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
}
