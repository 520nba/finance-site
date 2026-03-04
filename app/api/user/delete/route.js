import { NextResponse } from 'next/server';
import { readDoc, writeDoc, deleteDoc } from '@/lib/storage/kvClient';
import { deleteUser } from '@/lib/storage/userRepo';
import { isAdminAuthorized } from '@/lib/auth';

const STORAGE_KEY = 'users_config';

export async function POST(request) {
    try {
        const { adminId, targetUserId } = await request.json();

        // 统一权限验证
        if (!(await isAdminAuthorized(request, adminId))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        if (!targetUserId || targetUserId === 'admin') {
            return NextResponse.json({ error: 'Invalid target user' }, { status: 400 });
        }

        // 1. 从 D1 中物理删除 (新存储核心操作)
        const d1Deleted = await deleteUser(targetUserId);

        // 2. 清理旧 KV 数据 (兼容逻辑，确保双重干净)
        const userKey = `user:assets:${targetUserId}`;
        let kvDeleted = false;

        // 删除 KV 独立键
        const independentData = await readDoc(userKey, null);
        if (independentData) {
            await deleteDoc(userKey);
            kvDeleted = true;
        }

        // 从同步全量配置中移除
        const globalData = await readDoc(STORAGE_KEY, {});
        if (globalData[targetUserId]) {
            delete globalData[targetUserId];
            await writeDoc(STORAGE_KEY, globalData);
            kvDeleted = true;
        }

        // 从 KV 索引中移除 (如果还在用)
        const INDEX_KEY = 'users_index';
        const index = await readDoc(INDEX_KEY, []);
        const newIndex = index.filter(id => id !== targetUserId);
        if (index.length !== newIndex.length) {
            await writeDoc(INDEX_KEY, newIndex);
            kvDeleted = true;
        }

        if (d1Deleted || kvDeleted) {
            console.warn(`[Admin] User ${targetUserId} deleted by admin (D1: ${d1Deleted}, KV: ${kvDeleted})`);
            return NextResponse.json({ success: true, message: `User ${targetUserId} data removed.` });
        } else {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
