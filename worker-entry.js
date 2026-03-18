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
            case '15 14 * * 1-5': // Beijing 22:15
            case '0 19 * * 1-6':  // Beijing 03:00
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

    const BATCH_SIZE = 20; // 调大批处理量，支持高频分时同步
    try {
        const { results: jobs } = await DB.prepare(`
            UPDATE sync_jobs 
            SET status = 'processing', updated_at = CURRENT_TIMESTAMP 
            WHERE id IN (
                SELECT id FROM sync_jobs 
                WHERE status = 'pending' 
                   OR (status = 'processing' AND updated_at < datetime('now', '-10 minutes'))
                ORDER BY created_at ASC 
                LIMIT ?
            )
            RETURNING *
        `).bind(BATCH_SIZE).all();

        if (!jobs || jobs.length === 0) return;

        console.log(`[Queue:D1] Atomic lock: ${jobs.length} jobs`);

        const VALID_ASSET_TYPES = new Set(['stock', 'fund']);

        await Promise.allSettled(jobs.map(async (job) => {
            try {
                // ── 分时数据同步（针对 realtimeSync 投递的任务） ──────────────────────────────
                if (job.type === 'intraday_sync') {
                    const { fetchSingleIntraday } = await import('./lib/services/assetSyncService.js');
                    const { getBeijingTodayStr } = await import('./lib/utils.js');

                    const data = await fetchSingleIntraday(job.code);

                    if (data?.points?.length > 0) {
                        const db = env.DB;
                        const today = getBeijingTodayStr();
                        const jsonData = JSON.stringify({
                            code: job.code,
                            points: data.points,
                            price: data.price,
                            prevClose: data.prevClose
                        });
                        // 性能优化：直接全量覆盖写入结果。不再调用 updateIntradayJson 做冗余的“先读再合并”操作。
                        await db.prepare(
                            'INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
                        ).bind(job.code, today, jsonData).run();
                    }

                    await DB.prepare(
                        "UPDATE sync_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).bind(job.id).run();

                    // ── 历史数据同步（原有逻辑） ──────────────────────
                } else if (job.type === 'fund_history' || job.type === 'asset_history_sync') {
                    const { syncHistoryBulk } = await import('./lib/services/assetSyncService.js');

                    const payload = JSON.parse(job.payload || '{}');
                    const assetType = VALID_ASSET_TYPES.has(payload.type)
                        ? payload.type
                        : (job.type === 'fund_history' ? 'fund' : 'stock');

                    await syncHistoryBulk([{ code: job.code, type: assetType }], 250, true, env);

                    await DB.prepare(
                        "UPDATE sync_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).bind(job.id).run();

                } else {
                    console.warn(`[Queue:D1] Unsupported job type: ${job.type}`);
                    await DB.prepare(
                        "UPDATE sync_jobs SET status = 'failed', error_msg = 'Unsupported type', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).bind(job.id).run();
                }

            } catch (jobErr) {
                console.error(`[Queue:D1] Job ${job.id} failed:`, jobErr.message);
                await DB.prepare(`
                    UPDATE sync_jobs 
                    SET status = CASE WHEN retry_count + 1 < 3 THEN 'pending' ELSE 'failed' END,
                        error_msg = ?, 
                        retry_count = retry_count + 1, 
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `).bind(jobErr.message, job.id).run();
            }
        }));

        // 3. 自动清理机制：仅在每小时整点左右触发一次，防止表膨胀，同时减少 D1 扫描频率
        const minute = new Date().getMinutes();
        if (minute === 0) {
            await DB.prepare("DELETE FROM sync_jobs WHERE status IN ('completed', 'failed') AND updated_at < datetime('now', '-1 day')").run();
        }

    } catch (e) {
        console.error('[Queue:Critical] Batch process failure:', e.message);
    }
}
