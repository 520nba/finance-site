import { NextResponse } from 'next/server';
import { syncIntradayBulk } from '@/lib/services/assetSyncService';

export async function POST(request) {
    try {
        const { items } = await request.json();
        // 核心变更：强制仅读 D1。Cron 负责背景更新 JSON，此处不再触发外部同步。
        const result = await syncIntradayBulk(items, false, request);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}

