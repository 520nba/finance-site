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
        // ── 0. 每小时整点的保留期清理 ─────────────────────────────────────
        // 必须放在「队列为空即早退」之前：原先这段在函数末尾，队列空闲时根本
        // 走不到，导致过期任务/日志长期堆积（实测 1,662 行过期任务、最早到 10-09）。
        if (new Date().getMinutes() === 0) {
            await _runRetention(DB);
        }

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
                    const { upsertIntradaySnapshot } = await import('../storage/intradayRepo.js');
                    const { getBeijingTodayStr } = await import('../utils.js');

                    const today = getBeijingTodayStr();
                    // env 必须显式传入：scheduled 处理器没有请求上下文，
                    // getD1Storage() 会抛 D1_BINDING_MISSING（曾经导致静默失败）
                    const data = await fetchSingleIntraday(job.code, null, null, env);

                    if (data?.points?.length > 0 && data.source && data.source !== 'db') {
                        // 与当日已有 JSON 合并后落库（曲线只增不减）
                        await upsertIntradaySnapshot(job.code, today, data, env);
                        await DB.prepare(
                            "UPDATE sync_jobs SET status = 'completed', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                        ).bind(job.id).run();
                    } else {
                        // 所有数据源都失败：明确标记失败并留痕，不再假装 completed
                        const msg = `no intraday snapshot (source=${data?.source ?? 'none'})`;
                        console.warn(`[Queue:D1] intraday_sync ${job.code}: ${msg}`);
                        await DB.prepare(`
                            UPDATE sync_jobs
                            SET status = CASE WHEN retry_count + 1 < 3 THEN 'pending' ELSE 'failed' END,
                                error_msg = ?,
                                retry_count = retry_count + 1,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).bind(msg, job.id).run();
                    }

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

    } catch (e) {
        console.error('[Queue:Critical] Batch process failure:', e.message);
    }
}

/**
 * 每小时整点的保留期清理（逐条 try，任一失败不影响其它）
 */
async function _runRetention(DB) {
    const cleanups = [
        {
            name: 'sync_jobs',
            sql: "DELETE FROM sync_jobs WHERE status IN ('completed', 'failed') AND updated_at < datetime('now', '-1 day')"
        },
        {
            // 日志保留 30 天（走 idx_logs_timestamp 范围扫描）
            name: 'system_logs',
            sql: "DELETE FROM system_logs WHERE timestamp < datetime('now', '-30 days')"
        },
        {
            // 分时数据保留 60 天。必须写成 code IN (SELECT DISTINCT code ...) 形式，
            // 让计划命中主键 (code, record_date)；直接按 record_date 过滤会全表扫描
            // 32MB 的 data 页（EXPLAIN 实测 SCAN asset_intraday）。
            name: 'asset_intraday',
            sql: `DELETE FROM asset_intraday
                  WHERE code IN (SELECT DISTINCT code FROM asset_intraday)
                    AND record_date < date('now', '-60 days')`
        }
    ];

    for (const c of cleanups) {
        try {
            const res = await DB.prepare(c.sql).run();
            const changes = res?.meta?.changes || 0;
            if (changes > 0) console.log(`[Queue:Cleanup] ${c.name} pruned ${changes} rows`);
        } catch (e) {
            console.error(`[Queue:Cleanup] ${c.name} failed:`, e.message);
        }
    }
}
