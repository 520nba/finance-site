import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { getAllApiHealth } from '@/lib/storage/healthRepo';
import { memoryCache } from '@/lib/storage/memoryCache';

const STATS_CACHE_KEY = 'admin_stats_full';
const CACHE_TTL = 10000; // 10s 缂撳瓨

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const shouldSync = searchParams.get('sync') === 'true';

    if (!shouldSync) {
        const cached = memoryCache.get(STATS_CACHE_KEY);
        if (cached) {
            return NextResponse.json(cached);
        }
    }

    try {
        const { getD1Storage } = await import('@/lib/storage/d1Client');
        const db = await getD1Storage();

        if (shouldSync) {
            const { syncCounterFromTable } = await import('@/lib/storage/statsRepo');
            await Promise.all([
                syncCounterFromTable('users', 'users'),
                syncCounterFromTable('asset_stocks', 'asset_names', "type = 'stock'"),
                syncCounterFromTable('asset_funds', 'asset_names', "type = 'fund'"),
                syncCounterFromTable('quotes_count', 'asset_quotes')
            ]);
        }

        const { getCounters } = await import('@/lib/storage/statsRepo');
        const [counters, queueRow] = await Promise.all([
            getCounters([
                'users', 'asset_stocks', 'asset_funds', 'history_points',
                'intraday_points', 'quotes_count'
            ]),
            db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status = 'pending'").first().catch(() => ({ c: 0 }))
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
            queue_count: queueRow?.c || 0,
            db_engine: 'Cloudflare D1 (SQLite) + Counters',
            api_health: healthData || []
        };

        memoryCache.set(STATS_CACHE_KEY, finalStats, CACHE_TTL);

        return NextResponse.json(finalStats);
    } catch (e) {
        console.error('[AdminStats] Global Critical Failure:', e.message);
        return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
    }
}
