import { NextResponse } from 'next/server';
import { getAllUserIds } from '@/lib/storage/userRepo';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 浠?D1 鑾峰彇鎵€鏈夌敤鎴?ID
    const userIds = await getAllUserIds();

    // 鎺掗櫎 admin 璐﹀彿
    const filtered = userIds.filter(id => id !== 'admin');

    return NextResponse.json(filtered);
}
