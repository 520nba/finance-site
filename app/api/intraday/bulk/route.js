import { NextResponse } from 'next/server';
import { syncIntradayBulk } from '@/lib/services/assetSyncService';

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        // 允许前端在库内数据陈旧时触发一次外部补抓（此前写死 false，
        // 导致 cron 一旦失效浏览器只能反复拿到冻结的旧曲线）
        const result = await syncIntradayBulk(items, allowExternal === true);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}

