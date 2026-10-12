import { getBeijingDate } from '@/lib/utils';
import { isTradingHour } from '@/lib/constants/tradingHours';

function _isTradingHour() {
    return isTradingHour(getBeijingDate());
}

export async function runRealtimeSync(env) {
    if (!_isTradingHour()) {
        // 非交易时段每分钟/每 5 分钟都会走到这里。原先为了排查 cron 调度往 D1
        // 写了一条 INFO 日志（debug 提交 949cf45 引入），每天白写约 290 行，
        // 现在只保留 console，不再落库。
        console.log('[RealtimeSync] Outside trading hours, skipped.');
        return;
    }

    try {
        const { results: assets } = await env.DB
            .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'stock'")
            .all();

        if (!assets?.length) {
            const msg = 'No stock assets, skipped.';
            console.log(`[RealtimeSync] ${msg}`);
            await _log(env, 'INFO', 'RealtimeSync', msg);
            return;
        }

        // 只投任务，不做任何外部请求
        // ON CONFLICT 依赖 idx_sync_jobs_code_type_pending 唯一索引实现去重
        const stmts = assets.map(a =>
            env.DB.prepare(`
                INSERT INTO sync_jobs (type, code, payload, status)
                VALUES ('intraday_sync', ?, '{}', 'pending')
                ON CONFLICT(code, type) WHERE status = 'pending'
                DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            `).bind(a.code.toLowerCase())
        );

        // D1 batch 限制 100 条/批，需分片写入
        const CHUNK = 100;
        for (let i = 0; i < stmts.length; i += CHUNK) {
            await env.DB.batch(stmts.slice(i, i + CHUNK));
        }

        const msg = `Enqueued ${assets.length} intraday_sync jobs.`;
        console.log(`[RealtimeSync] ${msg}`);
        await _log(env, 'INFO', 'RealtimeSync', msg);
    } catch (e) {
        console.error('[RealtimeSync] Fatal:', e.message);
        await _log(env, 'ERROR', 'RealtimeSync', `Fatal: ${e.message}`);
    }
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

async function _log(env, level, module, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, module, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
            .bind(level, module, message)
            .run();
    } catch (e) {
        console.error('[RealtimeSync] log write failed:', e.message);
    }
}
