import { NextResponse } from 'next/server';
import { getAllUserIds } from '@/lib/storage/userRepo';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // �?D1 获取所有用�?ID
    const userIds = await getAllUserIds();

    // 排除 admin 账号
    const filtered = userIds.filter(id => id !== 'admin');

    return NextResponse.json(filtered);
}
