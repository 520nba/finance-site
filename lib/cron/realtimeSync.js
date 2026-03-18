import { getBeijingDate } from '@/lib/utils';

const TRADING_SESSIONS = [
    { open: '09:25', close: '11:35' }, // 早盘 (含开盘集合竞价)
    { open: '12:55', close: '15:05' }, // 午盘
];

function _isTradingHour() {
    const bjNow = getBeijingDate();
    const h = bjNow.getHours();
    const m = bjNow.getMinutes();
    const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return TRADING_SESSIONS.some(s => hhmm >= s.open && hhmm <= s.close);
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

        await env.DB.batch(stmts);

        console.log(`[RealtimeSync] Enqueued ${assets.length} intraday_sync jobs.`);
    } catch (e) {
        console.error('[RealtimeSync] Fatal:', e.message);
    }
}
