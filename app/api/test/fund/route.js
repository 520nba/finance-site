import { NextResponse } from 'next/server';
import { fetchFundHistory } from '@/lib/services/historyFetcher';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code') || '110020';
    const days = parseInt(searchParams.get('days') || '10');

    try {
        const data = await fetchFundHistory(code, days);
        return NextResponse.json({ success: true, code, days, data });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message });
    }
}
