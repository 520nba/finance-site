import { NextResponse } from 'next/server';
import { grabAndLockSyncTasks, updateSyncStatus, insertDailyPricesBatch } from '@/lib/storage/historyRepo';
import { fetchStockHistory, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';

export const dynamic = 'force-dynamic';

/**
 * 后台异步同步任务处理 (Cron 触发)
 * 逻辑：从 sync_queue 捞取待同步任务 -> 外部抓取 -> 写入 D1 -> 从队列删除
 */
export async function GET(request) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s 强制熔断，留出 5s 给日志/返回

    try {
        // 1. 原子化提取并锁定本批次任务 (减少单次数量，提升吞吐频率)
        const tasks = await grabAndLockSyncTasks(5);
        if (tasks.length === 0) {
            return NextResponse.json({ success: true, message: 'No pending tasks' });
        }

        let processed = 0;
        let failed = 0;

        // 2. 并行抓取 (网络密集型操作，并行提速)
        const fetchPromises = tasks.map(task => {
            const fetcher = task.type === 'fund'
                ? fetchFundHistory(task.code, 250, controller.signal)
                : fetchStockHistory(task.code, 250, controller.signal);

            return fetcher
                .then(h => ({ ...task, history: h }))
                .catch(err => {
                    // 即使失败也把任务上下文带出去，方便后续标记状态
                    err.task = task;
                    throw err;
                });
        });

        const results = await Promise.allSettled(fetchPromises);

        // 3. 串行写入 (DB 密集型操作，串行防并发锁定)
        for (const res of results) {
            if (res.status === 'fulfilled') {
                const { code, type, history } = res.value;
                if (history && history.length > 0) {
                    try {
                        const records = history.map(h => ({ code, type, price: h.value, date: h.date }));
                        await insertDailyPricesBatch(records);
                        await updateSyncStatus(code, type, 'done');
                        await addSystemLog('INFO', 'SyncCron', `OK: ${type}:${code} (${history.length} pts)`);
                        processed++;
                    } catch (dbErr) {
                        console.error(`[SyncCron] DB Error for ${code}:`, dbErr.message);
                        // If DB write fails, mark the task as error
                        await updateSyncStatus(code, type, 'error');
                        await addSystemLog('ERROR', 'SyncCron', `DB Error [${type}:${code}]: ${dbErr.message}`);
                        failed++;
                    }
                } else {
                    // No data returned from fetcher
                    console.warn(`[SyncCron] Empty data for ${type}:${code}`);
                    await updateSyncStatus(code, type, 'error');
                    await addSystemLog('WARN', 'SyncCron', `Fail: ${type}:${code} No Data`);
                    failed++;
                }
            } else {
                // Fetch promise was rejected (e.g., network error, API error, or timeout)
                // 稳健提取错误上下文：res.reason 可能本身就是 Error 对象或字符串
                const errorObj = res.reason || {};
                const taskContext = errorObj.task || { code: 'unknown', type: 'unknown' };
                const errorMsg = errorObj.message || String(errorObj);

                console.error(`[SyncCron] Fetch Error for ${taskContext.type}:${taskContext.code}:`, errorMsg);

                if (taskContext.code !== 'unknown') {
                    await updateSyncStatus(taskContext.code, taskContext.type, 'error');
                }

                await addSystemLog('ERROR', 'SyncCron', `Fetch Error [${taskContext.type}:${taskContext.code}]: ${errorMsg}`);
                failed++;
            }
        }

        const summary = `Batch Complete: ${processed} OK, ${failed} Error.`;
        return NextResponse.json({ success: true, message: summary });
    } catch (e) {
        console.error('[SyncCron] Critical Global Failure:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    } finally {
        clearTimeout(timeoutId);
    }
}