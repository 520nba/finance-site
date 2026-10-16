import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAssetSyncStatus } from '@/lib/storage/statsRepo';
import { getD1Storage } from '@/lib/storage/d1Client';

export const dynamic = 'force-dynamic';

export async function GET(request) {
        const denied = await requireAdmin(request);
    if (denied) return denied;

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
