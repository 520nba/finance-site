import { NextResponse } from 'next/server';
import { deleteUser } from '@/lib/storage/userRepo';
import { isAdminAuthorized } from '@/lib/storage/authRepo';

export async function POST(request) {
    try {
        const { targetUserId } = await request.json();

        // 统一权限验证
        if (!(await isAdminAuthorized(request))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        if (!targetUserId || targetUserId === 'admin') {
            return NextResponse.json({ error: 'Invalid target user' }, { status: 400 });
        }

        // 仅在 D1 中物理删除 (100% D1 化)
        const d1Deleted = await deleteUser(targetUserId);

        if (d1Deleted) {
            console.warn(`[Admin] User ${targetUserId} and all assets deleted by admin from D1`);
            return NextResponse.json({ success: true, message: `User ${targetUserId} data removed.` });
        } else {
            return NextResponse.json({ error: 'User not found in D1' }, { status: 404 });
        }

    } catch (e) {
        console.error(`[Admin] User deletion failed:`, e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
