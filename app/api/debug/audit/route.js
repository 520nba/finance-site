import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryAll, queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const queueCount = await queryOne('SELECT COUNT(*) as count FROM sync_queue');
        const queueData = await queryAll('SELECT * FROM sync_queue LIMIT 10');
        const historyDetail = await queryAll("SELECT code, record_date FROM asset_history WHERE type='fund' ORDER BY record_date DESC LIMIT 10");

        return NextResponse.json({
            success: true,
            queue_count: queueCount?.count,
            queue_sample: queueData,
            latest_history: historyDetail
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
