import { NextResponse } from 'next/server';
import { getAllUserIds } from '@/lib/storage/userRepo';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET(request) {
        const denied = await requireAdmin(request);
    if (denied) return denied;

    // fixed comment
    const userIds = await getAllUserIds();

    // fixed comment
    const filtered = userIds.filter(id => id !== 'admin');

    return NextResponse.json(filtered);
}
