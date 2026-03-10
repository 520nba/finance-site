import { NextResponse } from 'next/server';
export const runtime = 'edge';
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
            try { return (await queryOne(sql))?.count || 0; }
            catch (e) { return 0; }
        };

        const [
            userCount, stockCount, fundCount,
            histCount, intraPointsCount, quotesCount
        ] = await Promise.all([
            wrapQuery('SELECT COUNT(*) as count FROM users'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "stock"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "fund"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_history'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_intraday_points'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_quotes')
        ]);

        const growthCount = await wrapQuery("SELECT COUNT(*) as count FROM asset_history WHERE created_at > datetime('now', '-24 hours')");
        const healthData = await getAllApiHealth();
        const rawHealthCount = await wrapQuery("SELECT COUNT(*) as count FROM api_health");

        // 将调试信息持久化到系统日志表，直接在 UI 侧可见
        try {
            const debugMsg = `SentinelNodes: ${healthData?.length || 0}, DBRows: ${rawHealthCount}`;
            await addSystemLog('DEBUG', 'AdminStats', debugMsg);
        } catch (logErr) {
            console.error('[AdminStats] Log persistence failed:', logErr.message);
        }

        return NextResponse.json({
            users: userCount,
            stocks: stockCount,
            funds: fundCount,
            history_points: histCount,
            intraday_points: intraPointsCount,
            quotes_count: quotesCount,
            recent_growth: growthCount,
            db_engine: 'Cloudflare D1 (SQLite)',
            api_health: healthData || [],
            _debug: { health_table_count: rawHealthCount }
        });
    } catch (e) {
        return NextResponse.json({ error: e.message || 'INTERNAL_ERROR' }, { status: 500 });
    }
}
