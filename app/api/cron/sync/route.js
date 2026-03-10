import { NextResponse } from 'next/server';
import { getSyncTasks, updateSyncStatus, insertDailyPricesBatch } from '@/lib/storage/historyRepo';
import { fetchStockHistory, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';

export const dynamic = 'force-dynamic';

/**
 * 后台异步同步任务处理 (Cron 触发)
 * 逻辑：从 sync_queue 捞取待同步任务 -> 外部抓取 -> 写入 D1 -> 从队列删除
 */
export async function GET(request) {
    // 权限校验：如果是在 Cloudflare 环境，可以检查特定 Header
    // 这里简单处理，返回执行结果

    try {
        // 1. 获取本批次任务 (限制 10 条，避免单次执行时间太长)
        const tasks = await getSyncTasks(10);
        if (tasks.length === 0) {
            return NextResponse.json({ success: true, message: 'No pending sync tasks' });
        }

        let processed = 0;
        let failed = 0;

        for (const task of tasks) {
            const { code, type } = task;
            try {
                // 2. 标记状态为正在同步
                await updateSyncStatus(code, type, 'syncing');

                // 3. 执行抓取 (默认同步最近 250 天)
                let history = null;
                if (type === 'fund') {
                    history = await fetchFundHistory(code, 250);
                } else {
                    history = await fetchStockHistory(code, 250);
                }

                if (history && history.length > 0) {
                    // 4. 写入数据库
                    const records = history.map(h => ({
                        code,
                        type,
                        price: h.value,
                        date: h.date
                    }));
                    await insertDailyPricesBatch(records);

                    // 5. 标记完成 (删除记录)
                    await updateSyncStatus(code, type, 'done');
                    processed++;
                } else {
                    // 抓取到了空数据或失败
                    await updateSyncStatus(code, type, 'error');
                    failed++;
                }
            } catch (err) {
                console.error(`[SyncCron] Failed to process ${type}:${code}:`, err.message);
                await updateSyncStatus(code, type, 'error');
                failed++;
            }
        }

        const msg = `Processed ${processed} tasks, ${failed} failed.`;
        await addSystemLog('INFO', 'SyncCron', msg);

        return NextResponse.json({ success: true, message: msg });
    } catch (e) {
        console.error('[SyncCron] Global failure:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}