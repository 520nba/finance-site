/**
 * lib/queue/jobProcessor.js
 * 
 * D1 任务中心处理器逻辑
 */

import pLimit from 'p-limit';

// 历史任务的外呼并发闸：每轮最多 20 个 job 被领取，若全部并发，每个 job 又会
// 依次打 1~3 个外部源，实测会造成 ~60 条并发外呼并被源侧限流（表现为约 22%
// 的任务静默拿不到数据）。这里对「非分时」的重复型任务做全局并发限制。
const HEAVY_JOB_CONCURRENCY = 4;
const FAILURE_LOG_INTERVAL = 5 * 60 * 1000;
let _lastHistoryFailLogAt = 0;

/**
 * 历史同步失败留痕（节流 5 分钟一条，避免 51 个资产刷屏）
 */
async function _logHistoryFailure(env, detail) {
    const now = Date.now();
    if (now - _lastHistoryFailLogAt < FAILURE_LOG_INTERVAL) return;
    _lastHistoryFailLogAt = now;
    try {
        const { addSystemLog } = await import('../storage/logRepo.js');
        await addSystemLog('WARN', 'HistorySync', `history source unavailable → ${detail}`, env);
    } catch (e) {
        console.error('[Queue:D1] history failure log failed:', e.message);
    }
}

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

        const runJob = async (job) => {
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

                    const key = `${assetType}:${job.code}`;
                    const syncResult = await syncHistoryBulk([{ code: job.code, type: assetType }], 250, true, env);
                    const info = syncResult?.[key];

                    if (info && !info.no_source) {
                        await DB.prepare(
                            "UPDATE sync_jobs SET status = 'completed', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                        ).bind(job.id).run();
                    } else {
                        // 所有外部源都不可用 → 标记失败并可重试。
                        // 此前无论抓没抓到都标 completed，造成「队列全绿、数据缺失」。
                        const msg = `no history source (${info?.error || 'unknown'})`;
                        console.warn(`[Queue:D1] ${job.type} ${job.code}: ${msg}`);
                        await _logHistoryFailure(env, `${job.code}: ${msg}`);
                        await DB.prepare(`
                            UPDATE sync_jobs
                            SET status = CASE WHEN retry_count + 1 < 3 THEN 'pending' ELSE 'failed' END,
                                error_msg = ?,
                                retry_count = retry_count + 1,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).bind(msg.slice(0, 300), job.id).run();
                    }

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
        };

        // 分时任务轻量、对时效敏感 → 全并发（与原来一致）；
        // 历史任务每个要打 1~3 个外部源 → 走共享并发闸，避免把源打出限流。
        const intradayJobs = jobs.filter(j => j.type === 'intraday_sync');
        const heavyJobs = jobs.filter(j => j.type !== 'intraday_sync');
        const heavyLimit = pLimit(HEAVY_JOB_CONCURRENCY);

        await Promise.allSettled([
            ...intradayJobs.map(runJob),
            ...heavyJobs.map(job => heavyLimit(() => runJob(job)))
        ]);

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
        },
        {
            // 过期会话清理。expires_at 在 user_sessions 里是 ISO 串、在 admin_sessions 里是
            // 'YYYY-MM-DD HH:MM:SS'，两者都用 datetime() 解析后再比较，避免字符串比较误判。
            name: 'user_sessions',
            sql: "DELETE FROM user_sessions WHERE datetime(expires_at) <= datetime('now')"
        },
        {
            name: 'admin_sessions',
            sql: "DELETE FROM admin_sessions WHERE datetime(expires_at) <= datetime('now')"
        },
        {
            // 登录失败计数保留 1 天。时间列是 epoch 毫秒整数（auth_attempts），
            // 所以用 strftime('%s','now')*1000 换算，避免混用 ISO 字符串比较。
            name: 'auth_attempts',
            sql: "DELETE FROM auth_attempts WHERE updated_at_ms < (CAST(strftime('%s','now') AS INTEGER) * 1000 - 86400000)"
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
