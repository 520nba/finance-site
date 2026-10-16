import { NextResponse } from 'next/server';
import { purgeZombieAssets } from '@/lib/storage/maintenanceRepo';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function POST(request) {
        const denied = await requireAdmin(request);
    if (denied) return denied;

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
