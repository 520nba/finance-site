import { NextResponse } from 'next/server';
import { getGlobalUniqueAssets } from '@/lib/storage/userRepo';
import { syncNamesBulk } from '@/app/api/names/bulk/route';
import { syncHistoryBulk } from '@/app/api/history/bulk/route';
import { syncIntradayBulk } from '@/app/api/intraday/bulk/route';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const envSecret = process.env.CRON_SECRET;
    if (!envSecret || token !== envSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const task = searchParams.get('task') || 'all';

    try {
        // 直接从 D1 获取全站去重的唯一资产列表，效率提升 10 倍以上
        const itemsToSync = await getGlobalUniqueAssets();

        if (itemsToSync.length === 0) {
            return NextResponse.json({ success: true, message: 'No assets to sync' });
        }

        const results = {};

        // 每天同步 (基础信息 + 历史价格)
        if (task === 'daily' || task === 'all') {
            console.log(`[Cron] Starting DAILY sync for ${itemsToSync.length} items`);
            try {
                results.names = await syncNamesBulk(itemsToSync, true);
            } catch (e) {
                console.error('[Cron] syncNamesBulk failed:', e.message);
                results.names_error = e.message;
            }
            try {
                results.history = await syncHistoryBulk(itemsToSync, 250, true);
            } catch (e) {
                console.error('[Cron] syncHistoryBulk failed:', e.message);
                results.history_error = e.message;
            }
        }

        // 交易日内同步 (趋势分时)
        if (task === 'intraday' || task === 'all') {
            console.log(`[Cron] Starting INTRADAY sync for ${itemsToSync.length} items`);
            try {
                results.intraday = await syncIntradayBulk(itemsToSync, true);
            } catch (e) {
                console.error('[Cron] syncIntradayBulk failed:', e.message);
                results.intraday_error = e.message;
            }
        }

        return NextResponse.json({ success: true, count: itemsToSync.length, task });

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
