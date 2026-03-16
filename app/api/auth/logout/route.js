import { NextResponse } from 'next/server';
import { getRequiredDb } from '@/lib/storage/d1Client';
import { memoryCache } from '@/lib/storage/memoryCache';

export async function POST(request) {
    const token = request.cookies.get('session')?.value;

    if (token) {
        const db = await getRequiredDb();
        await db.prepare('DELETE FROM user_sessions WHERE token = ?').bind(token).run();
        memoryCache.delete(`sess:${token}`);
    }

    const res = NextResponse.json({ success: true });
    res.cookies.delete('session');

    return res;
}
