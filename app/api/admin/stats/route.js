import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';
import { getAllApiHealth } from '@/lib/storage/healthRepo';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        console.log('[Stats] Start fetching data...');

        // 1. 测试单项获取
        let userCount = 0;
        try {
            const u = await queryOne('SELECT COUNT(*) as count FROM users');
            userCount = u?.count || 0;
            console.log('[Stats] Users count OK:', userCount);
        } catch (e) { console.error('[Stats] Users count failed:', e.message); }

        // 2. 测试 API 健康获取
        let healthData = [];
        try {
            healthData = await getAllApiHealth();
            console.log('[Stats] Health data OK, nodes:', healthData?.length || 0);
        } catch (e) { console.error('[Stats] Health data failed:', e.message); }

        return NextResponse.json({
            users: userCount,
            stocks: 0,
            funds: 0,
            history_points: 0,
            intraday_points: 0,
            quotes_count: 0,
            recent_growth: 0,
            db_engine: 'Cloudflare D1 (SQLite)',
            api_health: healthData || [],
            _debug: { status: 'partial' }
        });
    } catch (e) {
        return NextResponse.json({ error: e.message || 'CRITICAL_ERROR', stack: e.stack }, { status: 500 });
    }
}
