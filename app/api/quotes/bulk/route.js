/**
 * app/api/quotes/bulk/route.js
 * 
 * 手动获取批量行情的路由入口。完全精简逻辑，交由业务 Service 处理。
 */

import { NextResponse } from 'next/server';
import { syncQuotesBulk } from '@/lib/services/quoteSyncService';

/**
 * 获取批量实时行情
 */
export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();

        // 调用业务逻辑服务
        const result = await syncQuotesBulk(items, allowExternal);

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
