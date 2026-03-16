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
        const data = await syncHistoryBulk(items, days)
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