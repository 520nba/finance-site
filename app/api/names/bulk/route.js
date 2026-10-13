/**
 * app/api/names/bulk/route.js
 *
 * 批量获取资产名称。
 *
 * 安全：需要登录 + items 上限（此前匿名即可触发外部抓取）。
 */

import { NextResponse } from 'next/server';
import { syncNamesBulk } from '@/lib/services/assetSyncService';
import { guardBulkRequest } from '@/lib/api/guards';

export async function POST(request) {
    const guard = await guardBulkRequest(request);
    if (!guard.ok) return guard.response;

    const { items, allowExternal = false } = guard.body;

    try {
        const result = await syncNamesBulk(items, allowExternal === true);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        console.error('[app/api/names/bulk/route.js]', e?.stack || e?.message || e);
        return NextResponse.json({ success: false, error: 'internal_error', code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
