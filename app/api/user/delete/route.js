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

        const globalData = await readDoc(STORAGE_KEY, {});
        const userKey = `user:assets:${targetUserId}`;
        let exists = false;

        // 1. 从旧全量配置中移除
        if (globalData[targetUserId]) {
            delete globalData[targetUserId];
            await writeDoc(STORAGE_KEY, globalData);
            exists = true;
        }

        // 2. 删除独立键
        // 这里我们尝试读取一遍来确认是否存在（因为 KV 没有 exists 检查）
        const independentData = await readDoc(userKey, null);
        if (independentData) {
            // 我们不真的调用 deleteDoc (目前没这封装)，而是写入空来模拟或直接清理
            // 这里为了彻底，我们直接调用 kv.delete
            import('@/lib/storage').then(async m => {
                const kv = await m.getKvStorage();
                if (kv) await kv.delete(userKey);
            }).catch(() => { });
            exists = true;
        }

        if (exists) {
            await addSystemLog('WARN', 'Admin', `User ${targetUserId} deleted by admin`);
            // 3. 触发全局清理动作
            cleanupOldData().catch(e => console.error('[Admin] Cleanup failed:', e));
            return NextResponse.json({ success: true, message: `User ${targetUserId} and their data removed.` });
        } else {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
