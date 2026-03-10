import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { runSql } from '@/lib/storage/d1Client';

export async function GET(request) {
    try {
        const res = await runSql("ALTER TABLE api_health ADD COLUMN heartbeat_ts TEXT DEFAULT '1970-01-01 00:00:00';");
        return NextResponse.json({ success: true, res });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
