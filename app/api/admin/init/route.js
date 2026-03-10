import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        console.log('[Init] Force applying schema for api_health...');

        await runSql(`
            CREATE TABLE IF NOT EXISTS api_health (
                api_name TEXT PRIMARY KEY,
                status TEXT DEFAULT 'unknown',
                success_rate REAL DEFAULT 0,
                avg_latency INTEGER DEFAULT 0,
                last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
                error_msg TEXT
            )
        `);

        return NextResponse.json({ success: true, message: 'Table api_health initialized.' });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
