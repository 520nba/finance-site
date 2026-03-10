import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

        console.log(`[CleanToday] Removing stock history data for date >= ${today}`);

        // 删除今天及以后的股票历史数据
        const res = await runSql(
            `DELETE FROM asset_history WHERE type = 'stock' AND record_date >= ?`,
            [today]
        );

        return NextResponse.json({ success: true, message: `Removed stock history for >= ${today}`, details: res });
    } catch (e) {
        console.error('[CleanToday] Failure:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
