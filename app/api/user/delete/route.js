import { NextResponse } from 'next/server';
import { readDoc, writeDoc, deleteDoc } from '@/lib/storage/kvClient';
import { addSystemLog } from '@/lib/storage/logRepo';
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

        const INDEX_KEY = 'users_index';
        const userKey = `user:assets:${targetUserId}`;
        let exists = false;

        // 1. 从旧全量配置中移除 (兼容逻辑)
        const globalData = await readDoc(STORAGE_KEY, {});
        if (globalData[targetUserId]) {
            delete globalData[targetUserId];
            await writeDoc(STORAGE_KEY, globalData);
            exists = true;
        }

        // 2. 删除独立键
        const independentData = await readDoc(userKey, null);
        if (independentData) {
            await deleteDoc(userKey);
            exists = true;
        }

        // 3. 从索引中移除 (核心：防止 Cron 继续生效)
        const index = await readDoc(INDEX_KEY, []);
        const newIndex = index.filter(id => id !== targetUserId);
        if (index.length !== newIndex.length) {
            await writeDoc(INDEX_KEY, newIndex);
            exists = true;
        }

        if (exists) {
            await addSystemLog('WARN', 'Admin', `User ${targetUserId} deleted by admin`);
            return NextResponse.json({ success: true, message: `User ${targetUserId} and their data removed.` });
        } else {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
