import { NextResponse } from 'next/server';
import { readDoc, writeDoc, cleanupOldData, addSystemLog } from '@/lib/storage';


const LEGACY_STORAGE_KEY = 'users_config';
const INDEX_KEY = 'users_index';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // 1. 尝试读取独立键 (新格式)
    const userKey = `user:assets:${userId}`;
    let userAssets = await readDoc(userKey, null);

    // 2. 如果不存在，尝试从全量配置迁移 (旧格式)
    if (!userAssets) {
        const globalData = await readDoc(LEGACY_STORAGE_KEY, {});
        userAssets = globalData[userId];
        if (userAssets) {
            // 自动触发迁移回填
            await writeDoc(userKey, userAssets);

            // 同时也把 ID 加入索引
            const index = await readDoc(INDEX_KEY, []);
            if (!index.includes(userId)) {
                index.push(userId);
                await writeDoc(INDEX_KEY, index);
            }

            await addSystemLog('INFO', 'Assets', `Migrated assets for user ${userId} to independent key`);
        } else {
            userAssets = [];
        }
    }

    return NextResponse.json(userAssets);
}

export async function POST(request) {
    try {
        const { userId, assets } = await request.json();

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        // 直接写入用户独立键，避免竞争冒险
        const userKey = `user:assets:${userId}`;
        const cleanAssets = assets.map(a => ({ code: a.code.toLowerCase(), type: a.type }));

        await writeDoc(userKey, cleanAssets);

        // 更新用户索引
        const index = await readDoc(INDEX_KEY, []);
        if (!index.includes(userId)) {
            index.push(userId);
            await writeDoc(INDEX_KEY, index);
        }

        await addSystemLog('INFO', 'Assets', `User ${userId} updated assets (${assets.length} items) via independent key`);

        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
