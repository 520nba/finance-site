/**
 * worker-entry.js
 * 
 * Cloudflare Workers 统一入口 (Refactored for D1 Task Queue)
 */

import openNextWorker from './.open-next/worker.js';
import { runHistorySync } from './lib/cron/historySync.js';
import { runRealtimeSync } from './lib/cron/realtimeSync.js';
import { runSentinel } from './lib/cron/sentinel.js';

export default {
    fetch(request, env, ctx) {
        return openNextWorker.fetch(request, env, ctx);
    },

    async scheduled(event, env, ctx) {
        switch (event.cron) {
            case '0 13 * * 1-5':
            case '0 19 * * 1-6':
                ctx.waitUntil(runHistorySync(env));
                break;
            case '*/5 1-7 * * 1-5':
                ctx.waitUntil(runRealtimeSync(env));
                break;
            case '*/15 * * * *':
                ctx.waitUntil(runSentinel(env));
                break;
            case '*/1 * * * *':
                // 切换至 D1 任务中心处理器
                ctx.waitUntil(processSyncJobs(env));
                break;
            default:
                console.warn(`[Scheduled] Unknown cron: "${event.cron}"`);
        }
    },
};

/**
 * D1 任务中心处理器
 * 采用原子锁定模式：通过 CTE 锁定任务并立即标记为 processing，防止多实例重复执行
 */
async function processSyncJobs(env) {
    const DB = env.DB;
    if (!DB) return;

    // 0. 预检：若无处于活跃状态的任务，直接退出以保护 D1 写入配额
    try {
        const activeCount = await DB.prepare("SELECT count(*) as count FROM sync_jobs WHERE status IN ('pending', 'processing')").first('count');
        if (activeCount === 0) return;
    } catch (countErr) {
        console.error('[Queue:PreCheck] Failed to count active jobs:', countErr.message);
    }

    // 1. 先把卡死超过 10 分钟的 processing 任务重置回 pending
    try {
        await DB.prepare(`
            UPDATE sync_jobs 
            SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE status = 'processing' 
            AND updated_at < datetime('now', '-10 minutes')
        `).run();
    } catch (cleanupErr) {
        console.error('[Queue:Cleanup] Reset stuck jobs failed:', cleanupErr.message);
    }


    const BATCH_SIZE = 5;
    try {
        // 1. 获取待处理任务 ID (拆分锁定逻辑以提高 D1/SQLite 兼容性)
        const { results: targets } = await DB.prepare(`
            SELECT id FROM sync_jobs 
            WHERE status = 'pending' 
            ORDER BY created_at ASC 
            LIMIT ?
        `).bind(BATCH_SIZE).all();

        if (!targets || targets.length === 0) return;
        const ids = targets.map(t => t.id);

        // 2. 批量更新状态为 processing
        const placeholders = ids.map(() => '?').join(',');
        await DB.prepare(`
            UPDATE sync_jobs 
            SET status = 'processing', updated_at = CURRENT_TIMESTAMP 
            WHERE id IN (${placeholders})
        `).bind(...ids).run();

        // 3. 重新获取完整的任务对象
        const { results: jobs } = await DB.prepare(`
            SELECT * FROM sync_jobs WHERE id IN (${placeholders})
        `).bind(...ids).all();

        if (!jobs || jobs.length === 0) return;

        console.log(`[Queue:D1] Processing ${jobs.length} jobs`);

        for (const job of jobs) {
            try {
                if (job.type === 'fund_history') {
                    const { syncHistoryBulk } = await import('./lib/services/assetSyncService');
                    let force = false;
                    try {
                        const payload = JSON.parse(job.payload || '{}');
                        force = !!payload.force;
                    } catch (e) { /* ignore */ }

                    // 传入 env 确保 service 内部获取正确的 DB 绑定，并透传 force 标志
                    await syncHistoryBulk([{ code: job.code, type: 'fund' }], 250, true, env, force);

                    await DB.prepare("UPDATE sync_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(job.id)
                        .run();
                } else {
                    console.warn(`[Queue:D1] Unknown job type: ${job.type}, job ${job.id} skipped`);
                    await DB.prepare("UPDATE sync_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(`Unknown type: ${job.type}`, job.id)
                        .run();
                }

            } catch (jobErr) {
                console.error(`[Queue:D1] Job ${job.id} failed:`, jobErr.message);
                // 重试逻辑：若 retry_count + 1 < 3 则回退到 pending，否则标记为 failed
                await DB.prepare(`
                    UPDATE sync_jobs 
                    SET status = CASE WHEN retry_count + 1 < 3 THEN 'pending' ELSE 'failed' END,
                        error_msg = ?, 
                        retry_count = retry_count + 1, 
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `)
                    .bind(jobErr.message, job.id)
                    .run();
            }
        }
    } catch (e) {
        console.error('[Queue:D1] Batch process failed:', e.message);
    }
}
