import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/storage/authRepo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getKvStorage } from '@/lib/storage/d1Client';

import { queryAll, getD1Storage } from '@/lib/storage/d1Client';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    try {
        // 读取最近 100 条任务状态用于前端显示
        const items = await queryAll(`
            SELECT id, code, status, type, updated_at 
            FROM sync_jobs 
            ORDER BY updated_at DESC LIMIT 100
        `);

        return NextResponse.json({
            queue: items.map(i => ({
                id: i.code,
                status: i.status,
                type: i.type,
                updatedAt: i.updated_at
            })),
            count: items.length,
            status: items.some(i => i.status === 'processing') ? 'running' : (items.some(i => i.status === 'pending') ? 'pending' : 'idle')
        });
    } catch (e) {
        return NextResponse.json({ error: e.message, status: 'error' }, { status: 500 });
    }
}

/**
 * 允许手动清理已完成或已失败的任务
 */
export async function DELETE(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    await db.prepare("DELETE FROM sync_jobs WHERE status IN ('completed', 'failed')").run();

    return NextResponse.json({ ok: true });
}
