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

    // 1. 自动复位逻辑：将卡死超过 10 分钟的 processing 任务重置回 pending
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
        // 2. 原子锁定：使用单条 SQL 完成选取、锁定与 RETURNING，彻底消除竞态窗口并减少 DB 往返
        const { results: jobs } = await DB.prepare(`
            UPDATE sync_jobs 
            SET status = 'processing', updated_at = CURRENT_TIMESTAMP 
            WHERE id IN (
                SELECT id FROM sync_jobs 
                WHERE status = 'pending' 
                ORDER BY created_at ASC 
                LIMIT ?
            )
            RETURNING *
        `).bind(BATCH_SIZE).all();

        if (!jobs || jobs.length === 0) return;

        console.log(`[Queue:D1] Concurrent processing ${jobs.length} jobs`);

        // 3. 并发执行：使用 Promise.allSettled 确保任务互不干扰且最大化利用 IO 窗口
        const VALID_ASSET_TYPES = new Set(['stock', 'fund']);

        await Promise.allSettled(jobs.map(async (job) => {
            try {
                // 仅处理历史数据同步任务
                if (job.type === 'fund_history' || job.type === 'asset_history_sync') {
                    const { syncHistoryBulk } = await import('./lib/services/assetSyncService');

                    const payload = JSON.parse(job.payload || '{}');
                    const force = !!payload.force;

                    // 类型推断：payload 最高优且受校验，job.type 为兜底
                    let assetType = VALID_ASSET_TYPES.has(payload.type)
                        ? payload.type
                        : (job.type === 'fund_history' ? 'fund' : 'stock');

                    // 调用服务层核心同步（自动包含拉取、对比、UPSERT）
                    await syncHistoryBulk([{ code: job.code, type: assetType }], 250, true, env, force);

                    // 任务归档
                    await DB.prepare("UPDATE sync_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(job.id)
                        .run();
                } else {
                    console.warn(`[Queue:D1] Unsupported job type: ${job.type}`);
                    await DB.prepare("UPDATE sync_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(`Unsupported type: ${job.type}`, job.id)
                        .run();
                }
            } catch (jobErr) {
                console.error(`[Queue:D1] Job ${job.id} execution failed:`, jobErr.message);
                // 容错与重试机制
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
        }));

    } catch (e) {
        console.error('[Queue:D1] Global batch process error:', e.message);
    }
}
