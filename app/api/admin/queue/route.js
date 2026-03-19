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
        // fixed comment
        const items = await queryAll(`
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
            GROUP BY j.id -- 闃叉涓€涓?code 瀵瑰簲澶氫釜 type 鏃朵骇鐢熼噸澶嶈
            ORDER BY j.updated_at DESC LIMIT 300
        `);

        return NextResponse.json({
            queue: items.map(i => ({
                id: i.id,
                code: i.code,
                name: i.asset_name || '鏈煡璧勪骇',
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
 * 鍏佽鎵嬪姩娓呯悊宸插畬鎴愭垨宸插け璐ョ殑浠诲姟
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
