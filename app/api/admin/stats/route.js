import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';
import { getAllApiHealth } from '@/lib/storage/healthRepo';
import { addSystemLog } from '@/lib/storage/logRepo';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const wrapQuery = async (sql) => {
            try {
                const res = await queryOne(sql);
                return res?.count || 0;
            }
            catch (e) {
                console.error(`[Stats] Query error for ${sql}:`, e.message);
                return 0;
            }
        };

        const [
            userCount, stockCount, fundCount,
            histCount, intraPointsCount, quotesCount,
            growthCount, healthData
        ] = await Promise.all([
            wrapQuery('SELECT COUNT(*) as count FROM users'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "stock"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "fund"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_history'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_intraday_points'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_quotes'),
            wrapQuery("SELECT COUNT(*) as count FROM asset_history WHERE created_at > datetime('now', '-24 hours')"),
            getAllApiHealth()
        ]);

        return NextResponse.json({
            users: userCount,
            stocks: stockCount,
            funds: fundCount,
            history_points: histCount,
            intraday_points: intraPointsCount,
            quotes_count: quotesCount,
            recent_growth: growthCount,
            db_engine: 'Cloudflare D1 (SQLite)',
            api_health: healthData || []
        });
    } catch (e) {
        console.error('[AdminStats] Global Error:', e.message);
        return NextResponse.json({ error: e.message || 'INTERNAL_ERROR' }, { status: 500 });
    }
}
