import { NextResponse } from 'next/server';

export async function isAdminAuthorized(request, payloadAdminId = null) {
    const adminKey = request.headers.get('x-admin-key');
    const searchParams = new URL(request.url).searchParams;
    const adminId = payloadAdminId || searchParams.get('adminId') || request.headers.get('x-admin-id');

    const envKey = process.env.ADMIN_API_KEY;

    if (envKey) {
        if (adminKey !== envKey) {
            return false; // Headers missing or mismatched ADMIN_API_KEY
        }
    } else {
        // Warning: Fallback to weak query param authentication if ADMIN_API_KEY is not set.
        // It's highly recommended to set ADMIN_API_KEY in production.
        console.warn('[Security] ADMIN_API_KEY is not set. Falling back to weak adminId verification.');
        if (adminId !== 'admin') {
            return false;
        }
    }

    return true;
}
