import { NextResponse } from 'next/server';
import { getAllUserIds } from '@/lib/storage/userRepo';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // fixed comment
    const userIds = await getAllUserIds();

    // fixed comment
    const filtered = userIds.filter(id => id !== 'admin');

    return NextResponse.json(filtered);
}
