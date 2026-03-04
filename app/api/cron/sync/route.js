import { NextResponse } from 'next/server';
import { readDoc } from '@/lib/storage/kvClient';
import { addSystemLog } from '@/lib/storage/logRepo';
import { syncNamesBulk } from '@/app/api/names/bulk/route';
import { syncHistoryBulk } from '@/app/api/history/bulk/route';
import { syncIntradayBulk } from '@/app/api/intraday/bulk/route';

const STORAGE_KEY = 'users_config';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    // 移除弱密码 fallback，强制要求环境密钥
    const envSecret = process.env.CRON_SECRET;
    if (!envSecret || token !== envSecret) {
        return NextResponse.json({ error: 'Unauthorized or secret not configured' }, { status: 403 });
    }

    const task = searchParams.get('task') || 'all'; // 'daily', 'intraday', 'all'

    try {
        const INDEX_KEY = 'users_index';
        const userIds = await readDoc(INDEX_KEY, []);
        const allItemsMap = new Map();

        // 并发读取每个用户的资产列表
        const userAssetLists = await Promise.all(userIds.map(async (userId) => {
            const userKey = `user:assets:${userId}`;
            const assets = await readDoc(userKey, []);
            return Array.isArray(assets) ? assets : [];
        }));

        // 汇总所有资产（去重）
        userAssetLists.forEach(list => {
            list.forEach(a => {
                if (a && a.code && a.type) {
                    const key = `${a.type}:${a.code}`;
                    if (!allItemsMap.has(key)) {
                        allItemsMap.set(key, { code: a.code, type: a.type });
                    }
                }
            });
        });

        const itemsToSync = Array.from(allItemsMap.values());
        if (itemsToSync.length === 0) {
            return NextResponse.json({ success: true, message: 'No assets to sync' });
        }

        // ⚡ 关键：串行执行，而非 Promise.all 并行
        // 原因：三个任务同时运行时总时间 = max(三者)，可能轻松超过 Cloudflare 的 30s 壁钟限制。
        // 串行后每个任务独立计时，且任意一个异常不会影响其他任务的执行。
        const results = {};

        // 每天早上 7 点触发的全局数据同步 (基础信息 + 日K历史)
        if (task === 'daily' || task === 'all') {
            await addSystemLog('INFO', 'Cron', `Starting DAILY sync for ${itemsToSync.length} items`);
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

        // 交易日正常交易时间触发的高频同步
        if (task === 'intraday' || task === 'all') {
            await addSystemLog('INFO', 'Cron', `Starting INTRADAY sync for ${itemsToSync.length} items`);
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
