import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getHistory } from '@/lib/storage/historyRepo';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code') || '110020';
    const type = searchParams.get('type') || 'fund';

    try {
        const history = await getHistory(code, type, 10);
        return NextResponse.json({ success: true, code, history });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
