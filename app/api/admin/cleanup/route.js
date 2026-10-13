import { NextResponse } from 'next/server';
import { purgeZombieAssets } from '@/lib/storage/maintenanceRepo';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';

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
        console.error('[app/api/admin/cleanup/route.js]', e?.stack || e?.message || e);
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
}
