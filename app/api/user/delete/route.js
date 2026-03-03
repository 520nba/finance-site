import { NextResponse } from 'next/server';
import { readDoc, writeDoc, cleanupOldData, addSystemLog } from '@/lib/storage';

const STORAGE_KEY = 'users_config';

export async function POST(request) {
    try {
        const { adminId, targetUserId } = await request.json();

        // 权限验证
        if (adminId !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        if (!targetUserId || targetUserId === 'admin') {
            return NextResponse.json({ error: 'Invalid target user' }, { status: 400 });
        }

        const data = await readDoc(STORAGE_KEY, {});

        if (data[targetUserId]) {
            // 1. 从配置中移除该用户
            delete data[targetUserId];
            await writeDoc(STORAGE_KEY, data);
            await addSystemLog('WARN', 'Admin', `User ${targetUserId} deleted by admin`);

            // 2. 触发全局清理动作
            // 这将遍历所有剩余用户的资产，并删除 KV 中不再被引用的历史/分时数据
            // 由于 cleanupOldData 已经是异步且带耗时的，我们在这里异步执行
            cleanupOldData().catch(e => console.error('[Admin] Cleanup failed:', e));

            return NextResponse.json({ success: true, message: `User ${targetUserId} and orphaned data removed.` });
        } else {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
