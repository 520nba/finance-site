import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        console.log('[Migrate] Upgrading api_health schema for heartbeat_ts...');

        // Add missing column heartbeat_ts WITHOUT dynamic DEFAULT
        await runSql("ALTER TABLE api_health ADD COLUMN heartbeat_ts DATETIME;").catch(e => console.log(e.message));

        return NextResponse.json({ success: true, message: 'api_health heartbeat_ts upgraded successfully.' });
    } catch (e) {
        console.error('[Migrate] Failure:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
