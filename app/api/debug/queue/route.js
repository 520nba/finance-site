import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryAll } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const queueStats = await queryAll(`
            SELECT status, COUNT(*) as count 
            FROM sync_queue 
            GROUP BY status
        `);

        const partialQueue = await queryAll(`
            SELECT * FROM sync_queue 
            ORDER BY updated_at DESC 
            LIMIT 20
        `);

        return NextResponse.json({
            success: true,
            stats: queueStats,
            recent: partialQueue
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
