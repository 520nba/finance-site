/**
 * app/api/quotes/bulk/route.js
 *
 * 批量获取实时行情。
 *
 * 安全：需要登录 + items 上限（此前匿名即可触发外部抓取，旁路了 /api/proxy 的鉴权设计）。
 */

import { NextResponse } from 'next/server';
import { syncQuotesBulk } from '@/lib/services/quoteSyncService';
import { guardBulkRequest } from '@/lib/api/guards';

export async function POST(request) {
    const guard = await guardBulkRequest(request);
    if (!guard.ok) return guard.response;

    const { items, allowExternal = false } = guard.body;

    try {
        const result = await syncQuotesBulk(items, allowExternal === true);

        return NextResponse.json({
            success: true,
            data: result
        });
    } catch (e) {
        console.error(`[API:QuotesBulk] Post failed:`, e.message);
        return NextResponse.json({
            success: false,
            error: e.message,
            code: 'INTERNAL_ERROR'
        }, { status: 500 });
    }
}
