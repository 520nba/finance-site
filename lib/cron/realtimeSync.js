import { getBeijingDate } from '@/lib/utils';
import { isTradingHour } from '@/lib/constants/tradingHours';

function _isTradingHour() {
    return isTradingHour(getBeijingDate());
}

export async function runRealtimeSync(env) {
    if (!_isTradingHour()) {
        const msg = 'Outside trading hours, skipped.';
        console.log(`[RealtimeSync] ${msg}`);
        // 可选：如果不希望日志太满，可以每小时只记一次，或者直接记
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
