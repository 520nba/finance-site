import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const schema = await runSql("SELECT name FROM sqlite_master WHERE type='table'");
        return NextResponse.json({ success: true, tables: schema.results });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
