import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // 利用 SQL 聚合查询，获取更全面的 D1 统计
        const stats = await Promise.all([
            queryOne('SELECT COUNT(*) as count FROM users'),
            queryOne('SELECT COUNT(*) as count FROM asset_names WHERE type = "stock"'),
            queryOne('SELECT COUNT(*) as count FROM asset_names WHERE type = "fund"'),
            queryOne('SELECT COUNT(*) as count FROM asset_history'),
            queryOne('SELECT COUNT(*) as count FROM asset_intraday_points'),
            queryOne('SELECT COUNT(*) as count FROM asset_quotes'),
            // 过去 24 小时的新记录数
            queryOne("SELECT COUNT(*) as count FROM asset_history WHERE created_at > datetime('now', '-24 hours')"),
        ]);

        return NextResponse.json({
            users: stats[0]?.count || 0,
            stocks: stats[1]?.count || 0,
            funds: stats[2]?.count || 0,
            history_points: stats[3]?.count || 0,
            intraday_points: stats[4]?.count || 0,
            quotes_count: stats[5]?.count || 0,
            recent_growth: stats[6]?.count || 0,
            db_engine: 'Cloudflare D1 (SQLite)'
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
