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
        const tableInfo = await queryAll("PRAGMA table_info(api_health)");
        const tableCount = (await queryOne("SELECT COUNT(*) as count FROM api_health"))?.count || 0;
        const rawRows = await queryAll("SELECT * FROM api_health");

        return NextResponse.json({
            success: true,
            table_schema: tableInfo,
            row_count: tableCount,
            rows: rawRows
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
