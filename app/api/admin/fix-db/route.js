import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        console.log('[Init] Ensuring production schema compatibility...');

        // 1. 同步队列
        await runSql(`
            CREATE TABLE IF NOT EXISTS sync_queue (
                code TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(code, type)
            )
        `);
        await runSql(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`);

        // 2. 分时点位 (之前的统计显示为 0，可能也是表没建)
        await runSql(`
            CREATE TABLE IF NOT EXISTS asset_intraday_points (
                code TEXT NOT NULL,
                time DATETIME NOT NULL,
                price REAL NOT NULL,
                vol REAL NOT NULL,
                PRIMARY KEY(code, time)
            )
        `);
        await runSql(`CREATE INDEX IF NOT EXISTS idx_intra_points_code_time ON asset_intraday_points(code, time DESC)`);

        return NextResponse.json({ success: true, message: 'Production tables (sync_queue, intraday_points) initialized.' });
    } catch (e) {
        console.error('[Init] Failure:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
