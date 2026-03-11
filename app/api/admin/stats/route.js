import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { queryOne } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';
import { getAllApiHealth } from '@/lib/storage/healthRepo';
import { memoryCache } from '@/lib/storage/memoryCache';

const STATS_CACHE_KEY = 'admin_stats_full';
const CACHE_TTL = 3600000; // 1 小时缓存

/**
 * 管理后台核心统计接口
 * 获取用户数、资产数、数据库量级以及外部 API 健康巡检结果。
 */
export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const cached = memoryCache.get(STATS_CACHE_KEY);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return NextResponse.json(cached.data);
    }

    try {
        const wrapQuery = async (sql) => {
            try {
                const res = await queryOne(sql);
                return res?.count || 0;
            }
            catch (e) {
                console.error(`[AdminStats] DB Query Failure [${sql}]:`, e.message);
                return 0;
            }
        };

        // 并行获取所有统计维度，极大缩短响应时长
        const [
            userCount,
            stockCount,
            fundCount,
            histCount,
            intraPointsCount,
            quotesCount,
            growthCount,
            queueCount,
            healthData
        ] = await Promise.all([
            wrapQuery('SELECT COUNT(*) as count FROM users'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "stock"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_names WHERE type = "fund"'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_history'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_intraday_points'),
            wrapQuery('SELECT COUNT(*) as count FROM asset_quotes'),
            wrapQuery("SELECT COUNT(*) as count FROM asset_history WHERE created_at > datetime('now', '-24 hours')"),
            wrapQuery('SELECT COUNT(*) as count FROM sync_queue'),
            (async () => {
                try {
                    return await getAllApiHealth();
                } catch (e) {
                    console.error('[AdminStats] Health check query failed:', e.message);
                    return [];
                }
            })()
        ]);

        const finalStats = {
            users: userCount,
            stocks: stockCount,
            funds: fundCount,
            history_points: histCount,
            intraday_points: intraPointsCount,
            quotes_count: quotesCount,
            recent_growth: growthCount,
            queue_count: queueCount,
            db_engine: 'Cloudflare D1 (SQLite)',
            api_health: healthData || []
        };

        // 写入内存缓存
        memoryCache.set(STATS_CACHE_KEY, {
            data: finalStats,
            timestamp: Date.now()
        });

        return NextResponse.json(finalStats);
    } catch (e) {
        console.error('[AdminStats] Global Critical Failure:', e.message);
        return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
}
