/**
 * lib/queue/jobProcessor.js
 * 
 * D1 任务中心处理器逻辑
 */

/**
 * D1 任务同步核心处理器
 * 采用原子锁定模式：通过 CTE 锁定任务并立即标记为 processing，防止多实例重复执行
 */
export async function processSyncJobs(env) {
    const DB = env.DB;
    if (!DB) return;

    const BATCH_SIZE = 20; // 支持高频分时同步的批处理量
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
                // ── 分时数据同步 (intraday_sync) ──────────────────────────────
                if (job.type === 'intraday_sync') {
                    const { fetchSingleIntraday } = await import('../services/assetSyncService.js');
                    const { getBeijingTodayStr } = await import('../utils.js');

                    const data = await fetchSingleIntraday(job.code);

                    if (data?.points?.length > 0) {
                        const today = getBeijingTodayStr();
                        const jsonData = JSON.stringify({
                            code: job.code,
                            points: data.points,
                            price: data.price,
                            prevClose: data.prevClose
                        });
                        // 性能优化：直接全量覆盖写入结果。不再调用 updateIntradayJson 做冗余的“先读再合并”操作。
                        await DB.prepare(
                            'INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
                        ).bind(job.code, today, jsonData).run();
                    }

                    await DB.prepare(
                        "UPDATE sync_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                    ).bind(job.id).run();

                    // ── 历史数据同步 (fund_history / asset_history_sync) ──────────────────────
                } else if (job.type === 'fund_history' || job.type === 'asset_history_sync') {
                    const { syncHistoryBulk } = await import('../services/assetSyncService.js');

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

        // 3. 自动清理机制：仅在每小时整点触发一次
        const minute = new Date().getMinutes();
        if (minute === 0) {
            await DB.prepare("DELETE FROM sync_jobs WHERE status IN ('completed', 'failed') AND updated_at < datetime('now', '-1 day')").run();
        }

    } catch (e) {
        console.error('[Queue:Critical] Batch process failure:', e.message);
    }
}
