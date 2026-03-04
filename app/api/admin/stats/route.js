import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // 利用 SQL 聚合查询，一次性获取精确统计
        const stats = await Promise.all([
            queryOne('SELECT COUNT(*) as count FROM users'),
            queryOne('SELECT COUNT(*) as count FROM asset_names WHERE type = "stock"'),
            queryOne('SELECT COUNT(*) as count FROM asset_names WHERE type = "fund"'),
            queryOne('SELECT COUNT(*) as count FROM asset_history'),
        ]);

        return NextResponse.json({
            users: stats[0]?.count || 0,
            stocks: stats[1]?.count || 0,
            funds: stats[2]?.count || 0,
            history_points: stats[3]?.count || 0
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
