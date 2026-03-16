import { NextResponse } from 'next/server';
import { revokeSession } from '@/lib/storage/authRepo';

export async function POST(request) {
    const token = request.cookies.get('session')?.value;
    if (token) {
        await revokeSession(token);
    }

    const res = NextResponse.json({ success: true });
    res.cookies.delete('session');

    return res;
}
