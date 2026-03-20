import { getBeijingDate } from '@/lib/utils';
import { isTradingHour } from '@/lib/constants/tradingHours';

function _isTradingHour() {
    return isTradingHour(getBeijingDate());
}

export async function runRealtimeSync(env) {
    if (!_isTradingHour()) {
        console.log('[RealtimeSync] Outside trading hours, skipped.');
        return;
    }

    try {
        const { results: assets } = await env.DB
            .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'stock'")
            .all();

        if (!assets?.length) {
            console.log('[RealtimeSync] No stock assets, skipped.');
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
            `).bind(a.code)
        );

        // D1 batch 限制 100 条/批，需分片写入
        const CHUNK = 100;
        for (let i = 0; i < stmts.length; i += CHUNK) {
            await env.DB.batch(stmts.slice(i, i + CHUNK));
        }

        console.log(`[RealtimeSync] Enqueued ${assets.length} intraday_sync jobs.`);
    } catch (e) {
        console.error('[RealtimeSync] Fatal:', e.message);
    }
}
