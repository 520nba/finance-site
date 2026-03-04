import { NextResponse } from 'next/server';

import { getKvStorage, readDoc } from '@/lib/storage/kvClient';

export async function isAdminAuthorized(request, payloadAdminId = null) {
    // 1. 优先尝试 Session Token (推荐)
    const sessionToken = request.headers.get('x-admin-session');
    if (sessionToken) {
        const session = await readDoc(`session:${sessionToken}`);
        if (session && session.expiresAt > Date.now()) {
            return true;
        }
    }

    // 2. 后备方案：长期 PSK (用于 CRON 或特殊场景)
    const adminKey = request.headers.get('x-admin-key');
    const searchParams = new URL(request.url).searchParams;
    const adminId = payloadAdminId || searchParams.get('adminId') || request.headers.get('x-admin-id');
    const envKey = process.env.ADMIN_API_KEY;

    if (envKey) {
        if (adminKey === envKey) return true;
    } else {
        // Warning: Fallback to weak query param authentication if ADMIN_API_KEY is not set.
        if (adminId === 'admin') return true;
    }

    return false;
}
