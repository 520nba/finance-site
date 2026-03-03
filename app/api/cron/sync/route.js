import { NextResponse } from 'next/server';
import { readDoc, addSystemLog } from '@/lib/storage';
import { syncNamesBulk } from '@/app/api/names/bulk/route';
import { syncHistoryBulk } from '@/app/api/history/bulk/route';
import { syncQuotesBulk } from '@/app/api/quotes/bulk/route';
import { syncIntradayBulk } from '@/app/api/intraday/bulk/route';

const STORAGE_KEY = 'users_config';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    // 简单的安全校验，生产上可通过环境变量提供密钥
    if (token !== (process.env.CRON_SECRET || 'antigravity_sync')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const task = searchParams.get('task') || 'all'; // 'daily', 'intraday', 'all'
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;

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

        // 汇总所有资产
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

        const promises = [];

        // 每天早上 7 点触发的全局数据同步 (基础信息 + 日K历史)
        if (task === 'daily' || task === 'all') {
            await addSystemLog('INFO', 'Cron', `Starting DAILY sync for ${itemsToSync.length} items`);
            promises.push(syncNamesBulk(itemsToSync, true));
            promises.push(syncHistoryBulk(itemsToSync, 250, true));
        }

        // 交易日正常交易时间触发的高频同步 (实时股价 + 当日分时)
        if (task === 'intraday' || task === 'all') {
            await addSystemLog('INFO', 'Cron', `Starting INTRADAY sync for ${itemsToSync.length} items`);
            const stocksOnly = itemsToSync.filter(i => i.type === 'stock');
            if (stocksOnly.length > 0) {
                promises.push(syncQuotesBulk(stocksOnly, true));
            }
            promises.push(syncIntradayBulk(itemsToSync, true));
        }

        // Edge 运行时需阻塞等待并发请求完毕，不能脱机后台执行
        await Promise.all(promises);

        return NextResponse.json({ success: true, count: itemsToSync.length, task });

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
