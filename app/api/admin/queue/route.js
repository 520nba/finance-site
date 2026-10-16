import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryAll, getD1Storage } from '@/lib/storage/d1Client';

export async function GET(request) {
        const denied = await requireAdmin(request);
    if (denied) return denied;

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
                (SELECT n.name FROM asset_names n WHERE n.code = j.code LIMIT 1) as asset_name
            FROM sync_jobs j
        `;
        const params = [];

        if (filterType && filterType !== 'all') {
            query += ' WHERE j.type = ? ';
            params.push(filterType);
        }

        // 取最近 600 条：ORDER BY id DESC 命中 INTEGER PRIMARY KEY 反向扫描，取满即停。
        // 原实现是 `GROUP BY j.id ORDER BY j.updated_at DESC`，EXPLAIN 实测为
        // `SCAN j` + `USE TEMP B-TREE FOR ORDER BY`（全表 3k 行扫描并排序）；
        // 同时把 LEFT JOIN 换成按主键的标量子查询，避免同 code 多 type 时的行放大。
        query += ' ORDER BY j.id DESC LIMIT 600';

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
        console.error('[app/api/admin/queue/route.js]', e?.stack || e?.message || e);
        return NextResponse.json({ error: 'internal_error', status: 'error' }, { status: 500 });
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
