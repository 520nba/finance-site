import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryAll, getD1Storage } from '@/lib/storage/d1Client';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    try {
        const { searchParams } = new URL(request.url);
        const filterType = searchParams.get('type');

        let query = `
            SELECT 
                j.id, 
                j.code, 
                j.status, 
                j.type, 
                j.created_at, 
                j.updated_at,
                n.name as asset_name
            FROM sync_jobs j
            LEFT JOIN asset_names n ON j.code = n.code
        `;
        const params = [];

        if (filterType && filterType !== 'all') {
            query += ' WHERE j.type = ? ';
            params.push(filterType);
        }

        query += ' GROUP BY j.id ORDER BY j.updated_at DESC LIMIT 600';

        const items = await queryAll(query, params);

        return NextResponse.json({
            queue: items.map(i => ({
                id: i.id,
                code: i.code,
                name: i.asset_name || '未知资产',
                status: i.status,
                type: i.type,
                created_at: i.created_at,
                updated_at: i.updated_at
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
