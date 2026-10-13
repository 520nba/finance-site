import { NextResponse } from 'next/server';
import { syncIntradayBulk } from '@/lib/services/assetSyncService';
import { guardBulkRequest } from '@/lib/api/guards';

export async function POST(request) {
    // 安全：需要登录 + items 上限（allowExternal 打开后，匿名调用可触发外部抓取）
    const guard = await guardBulkRequest(request);
    if (!guard.ok) return guard.response;

    const { items, allowExternal = false } = guard.body;

    try {
        // 允许前端在库内数据陈旧时触发一次外部补抓（此前写死 false，
        // 导致 cron 一旦失效浏览器只能反复拿到冻结的旧曲线）
        const result = await syncIntradayBulk(items, allowExternal === true);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        console.error('[app/api/intraday/bulk/route.js]', e?.stack || e?.message || e);
        return NextResponse.json({ success: false, error: 'internal_error', code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
