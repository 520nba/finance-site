import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { getAssetSyncStatus } from '@/lib/storage/statsRepo';
import { getD1Storage } from '@/lib/storage/d1Client';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    try {
        const assets = await getAssetSyncStatus({ env: { DB: db } });
        return NextResponse.json({ assets });
    } catch (e) {
        console.error('[app/api/admin/assets/status/route.js]', e?.stack || e?.message || e);
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
}
