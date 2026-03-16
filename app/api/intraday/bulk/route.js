import { NextResponse } from 'next/server';
import { syncIntradayBulk } from '@/lib/services/assetSyncService';

export async function POST(request) {
    try {
        const { items, allowExternal = false } = await request.json();
        const result = await syncIntradayBulk(items, allowExternal, request);
        return NextResponse.json({ success: true, data: result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}

