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
        const { getD1Storage, getCloudflareCtx } = await import('@/lib/storage/d1Client');
        const db = await getD1Storage();

        const { syncCounterFromTable, getCounters } = await import('@/lib/storage/statsRepo');

        // 全量重算清单。此前只重算 4 项，history_points / intraday_points
        // 从未被任何代码维护过 → 管理端长期显示 7 个月前的数字、分时点位数恒为 0。
        // 另外股票/基金数原先统计 asset_names（名称缓存，会包含已无人跟踪的孤儿条目，
        // 实测虚高 2 个），改为统计 user_assets 才是"正在跟踪的资产"。
        const FULL_COUNTER_SYNC = [
            ['users', 'users'],
            ['asset_stocks', 'user_assets', "type = 'stock'"],
            ['asset_funds', 'user_assets', "type = 'fund'"],
            ['quotes_count', 'asset_quotes'],
            ['history_points', 'asset_history'],
            ['intraday_points', 'asset_intraday']
        ];
        const MAINTAINED_KEYS = FULL_COUNTER_SYNC.map(([key]) => key);

        const recountAll = async () => {
            for (const [key, table, where] of FULL_COUNTER_SYNC) {
                await syncCounterFromTable(key, table, where || undefined);
            }
        };

        if (shouldSync) {
            await recountAll();
        } else {
            // 自愈：被维护的计数器整体超过 6 小时未更新时，在后台补一次重算
            // （每个 isolate 10 分钟最多一次，避免管理端反复打开造成 COUNT(*) 放大）。
            // 注意只统计 MAINTAINED_KEYS——queue_count 等遗留行的时间戳很旧，
            // 若纳入 MIN() 会导致每次打开管理端都误判为"陈旧"而反复重算。
            const RECOUNT_KEY = 'admin_counters_recount_at';
            const lastRecount = memoryCache.get(RECOUNT_KEY) || 0;
            if (Date.now() - lastRecount > 10 * 60 * 1000) {
                try {
                    const placeholders = MAINTAINED_KEYS.map(() => '?').join(',');
                    const row = await db.prepare(
                        `SELECT MIN(updated_at) AS oldest FROM system_stats WHERE key IN (${placeholders})`
                    ).bind(...MAINTAINED_KEYS).first();
                    const oldestMs = row?.oldest ? new Date(`${row.oldest}Z`).getTime() : 0;
                    if (!oldestMs || Date.now() - oldestMs > 6 * 3600 * 1000) {
                        memoryCache.set(RECOUNT_KEY, Date.now());
                        const cf = await getCloudflareCtx();
                        const task = recountAll();
                        if (cf?.ctx?.waitUntil) cf.ctx.waitUntil(task);
                        else await task;
                    }
                } catch (e) {
                    console.error('[AdminStats] counter self-heal skipped:', e.message);
                }
            }
        }

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
