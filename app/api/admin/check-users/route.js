import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { queryAll } from '@/lib/storage/d1Client';

export async function GET() {
    try {
        const users = await queryAll('SELECT * FROM users');
        const userAssets = await queryAll('SELECT DISTINCT code, type, user_id FROM user_assets');

        return NextResponse.json({ success: true, users, userAssets });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
