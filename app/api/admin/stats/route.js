import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryOne, queryAll } from '@/lib/storage/d1Client';
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
                return { count: res?.count || 0, error: null };
            }
            catch (e) {
                console.error(`[Stats] Query error for ${sql}:`, e.message);
                return { count: 0, error: e.message };
            }
        };

        const [
            userCount, stockCount, fundCount,
            healthData, healthCountInfo
        ] = await Promise.all([
            wrapQuery('SELECT COUNT(*) as count FROM users'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "stock"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "fund"'),
            getAllApiHealth(),
            wrapQuery('SELECT COUNT(*) as count FROM api_health')
        ]);

        // 强阻塞式日志，确保调试信息必定入库
        const debugMsg = `HealthNodes: ${healthData?.length || 0}, TableRows: ${healthCountInfo.count}, Error: ${healthCountInfo.error || 'None'}`;
        await addSystemLog('DEBUG', 'AdminStats', debugMsg);

        return NextResponse.json({
            users: userCount.count,
            stocks: stockCount.count,
            funds: fundCount.count,
            db_engine: 'Cloudflare D1 (SQLite)',
            api_health: healthData || [],
            _errors: {
                health_query: healthCountInfo.error,
                user_query: userCount.error
            },
            _debug: { health_table_count: healthCountInfo.count }
        });
    } catch (e) {
        return NextResponse.json({ error: e.message || 'INTERNAL_ERROR' }, { status: 500 });
    }
}
