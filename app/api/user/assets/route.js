import { NextResponse } from 'next/server';
import { readDoc, writeDoc, cleanupOldData, addSystemLog } from '@/lib/storage';


const STORAGE_KEY = 'users_config';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const data = await readDoc(STORAGE_KEY, {});
    const userAssets = data[userId] || [];
    return NextResponse.json(userAssets);
}

export async function POST(request) {
    try {
        const { userId, assets } = await request.json();

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        const data = await readDoc(STORAGE_KEY, {});
        // 记录更新前的所有活跃资产，用于判定是否有人删除了自选
        const oldActiveCodes = new Set();
        Object.values(data).forEach(list => list.forEach(a => oldActiveCodes.add(a.code)));

        data[userId] = assets.map(a => ({ code: a.code, type: a.type }));
        await writeDoc(STORAGE_KEY, data);
        await addSystemLog('INFO', 'Assets', `User ${userId} updated assets (${assets.length} items)`);

        // 如果更新后某些代码彻底消失在所有用户的列表中，触发清理
        const newActiveCodes = new Set();
        Object.values(data).forEach(list => list.forEach(a => newActiveCodes.add(a.code)));

        for (const code of oldActiveCodes) {
            if (!newActiveCodes.has(code)) {
                // 该资产已不再被任何人关注，异步执行物理删除
                import('@/lib/storage').then(m => m.deleteAssetData(code)).catch(() => { });
            }
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
