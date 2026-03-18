import { NextResponse } from 'next/server'
import { syncHistoryBulk } from '@/lib/services/assetSyncService'

const HISTORY_DAYS = 250

/**
 * =============================
 * API
 * =============================
 */

export async function POST(request) {
    try {
        const { items, days = HISTORY_DAYS } = await request.json()
        // 性能加固：由路由层强制屏蔽 allowExternal。外部同步仅允许由 Cron 任务触发。
        const data = await syncHistoryBulk(items, days, false)
        return NextResponse.json({
            success: true,
            data
        })
    } catch (e) {
        console.error('[HistoryBulkAPI] Fatal Error:', e);
        return NextResponse.json(
            { success: false, error: e.message },
            { status: 500 }
        )
    }
}