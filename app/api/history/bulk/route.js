import { NextResponse } from 'next/server'
import { syncHistoryBulk } from '@/lib/services/assetSyncService'
import { guardBulkRequest } from '@/lib/api/guards';

const HISTORY_DAYS = 250

/**
 * =============================
 * API
 * =============================
 */

export async function POST(request) {
    // 安全：需要登录 + items 上限
    const guard = await guardBulkRequest(request);
    if (!guard.ok) return guard.response;

    try {
        const { items, days = HISTORY_DAYS } = guard.body
        // 性能加固：由路由层强制屏蔽 allowExternal。外部同步仅允许由 Cron 任务触发。
        // days 收敛到 [1, 250]：SQLite LIMIT 由它决定，避免异常值放大查询
        const safeDays = Math.min(Math.max(parseInt(days, 10) || HISTORY_DAYS, 1), HISTORY_DAYS)
        const data = await syncHistoryBulk(items, safeDays, false)
        return NextResponse.json({
            success: true,
            data
        })
    } catch (e) {
        console.error('[HistoryBulkAPI] Fatal Error:', e);
        return NextResponse.json(
            { success: false, error: 'internal_error' },
            { status: 500 }
        )
    }
}
