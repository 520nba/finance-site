import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/requireUser';

export async function GET(request) {
    const userId = await requireUser(request);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ userId });
}
