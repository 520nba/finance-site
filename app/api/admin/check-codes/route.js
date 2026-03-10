import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { queryAll } from '@/lib/storage/d1Client';

export async function GET() {
    try {
        const assets = await queryAll('SELECT * FROM user_assets');
        const historySample = await queryAll('SELECT code, type, record_date FROM asset_history ORDER BY record_date DESC LIMIT 50');
        const names = await queryAll('SELECT code, type, name FROM asset_names');

        return NextResponse.json({ success: true, assets, historySample, names });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
