import { NextResponse } from 'next/server';
export const runtime = 'edge';
import { queryOne, queryAll } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';
import { getAllApiHealth } from '@/lib/storage/healthRepo';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const wrapQuery = async (sql) => {
            try { return (await queryOne(sql))?.count || 0; }
            catch (e) { console.warn(`[Stats] Query failed for [${sql}]:`, e.message); return 0; }
        };

        const [
            userCount,
            stockCount,
            fundCount,
            histCount,
            intraPointsCount,
            quotesCount
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

        // [Debug] Log to Cloudflare Workers Logs
        console.log(`[AdminStats] Health Check Nodes: ${healthData?.length || 0}, Table Row Count: ${rawHealthCount}`);

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
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
