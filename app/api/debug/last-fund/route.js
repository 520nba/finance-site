import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const latestFundPoint = await queryOne(\`
            SELECT code, record_date, price 
            FROM asset_history 
            WHERE type = 'fund' 
            ORDER BY record_date DESC 
            LIMIT 1
        \`);

        return NextResponse.json({
            success: true,
            latest: latestFundPoint
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
