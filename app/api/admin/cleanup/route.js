import { NextResponse } from 'next/server';
import { purgeZombieAssets } from '@/lib/storage';
import { isAdminAuthorized } from '@/lib/auth';

export async function POST(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const result = await purgeZombieAssets();
        if (result.success) {
            return NextResponse.json(result);
        } else {
            return NextResponse.json(result, { status: 500 });
        }
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
