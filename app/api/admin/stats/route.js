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

        const { searchParams } = new URL(request.url);
        const shouldSync = searchParams.get('sync') === 'true';

        // 1. 如果带了 sync 参数，执行昂贵的全量校准 (仅限管理员手动操作)
        if (shouldSync) {
            const { syncCounterFromTable } = await import('@/lib/storage/statsRepo');
            await Promise.all([
                syncCounterFromTable('users', 'users'),
                syncCounterFromTable('asset_stocks', 'asset_names', 'type = "stock"'),
                syncCounterFromTable('asset_funds', 'asset_names', 'type = "fund"'),
                syncCounterFromTable('history_points', 'asset_history'),
                syncCounterFromTable('intraday_points', 'asset_intraday_points'),
                syncCounterFromTable('quotes_count', 'asset_quotes'),
                syncCounterFromTable('queue_count', 'sync_queue')
            ]);
        }

        // 2. 从计数器批量获取数据 (O(1) 复杂度)
        const { getCounters } = await import('@/lib/storage/statsRepo');
        const counters = await getCounters([
            'users', 'asset_stocks', 'asset_funds', 'history_points',
            'intraday_points', 'quotes_count', 'queue_count'
        ]);

        const healthData = await (async () => {
            try { return await getAllApiHealth(); } catch (e) { return []; }
        })();

        const finalStats = {
            users: counters.users,
            stocks: counters.asset_stocks,
            funds: counters.asset_funds,
            history_points: counters.history_points,
            intraday_points: counters.intraday_points,
            quotes_count: counters.quotes_count,
            queue_count: counters.queue_count,
            db_engine: 'Cloudflare D1 (SQLite) + Counters',
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
