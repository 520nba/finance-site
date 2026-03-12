import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { queryAll } from '@/lib/storage/d1Client';
import { addToSyncQueue } from '@/lib/storage/historyRepo';
import { addSystemLog } from '@/lib/storage/logRepo';

/**
 * 每日全量同步触发器
 * 1. 从 user_assets 中找出所有正在被追踪的资产 (DISTINCT code, type)
 * 2. 批量将它们塞入 sync_queue 队列
 * 3. 接下来由每分钟运行一次的 sync cron 逐步消化
 */
export async function GET(request) {
    try {
        // 获取所有活跃资产
        const assets = await queryAll('SELECT DISTINCT code, type FROM user_assets');

        if (assets.length === 0) {
            return NextResponse.json({ success: true, message: 'No assets to sync' });
        }

        // 插入同步队列 (INSERT OR IGNORE)
        await addToSyncQueue(assets);

        const msg = `Daily: Queued ${assets.length} assets for full refresh.`;
        console.log(`[DailyCron] ${msg}`);

        await addSystemLog('INFO', 'DailyCron', msg);

        return NextResponse.json({ success: true, message: msg });
    } catch (e) {
        console.error('[DailyCron] failure:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
