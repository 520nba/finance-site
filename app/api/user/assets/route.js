import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage';

export const runtime = 'edge';

const STORAGE_KEY = 'users_config';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const data = await readDoc(STORAGE_KEY, {});
    const userAssets = data[userId] || [];
    return NextResponse.json(userAssets);
}

export async function POST(request) {
    try {
        const { userId, assets } = await request.json();

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        const data = await readDoc(STORAGE_KEY, {});
        data[userId] = assets.map(a => ({ code: a.code, type: a.type }));
        await writeDoc(STORAGE_KEY, data);

        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
