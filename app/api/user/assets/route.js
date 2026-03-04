import { NextResponse } from 'next/server';
import { readDoc, writeDoc, addSystemLog, cleanupSingleAssetIfNotUsed } from '@/lib/storage';

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

        // 获取用户当前的资产以便比对（寻找被删掉的）
        const userKey = `user:assets:${userId}`;
        const oldAssets = await readDoc(userKey, []);

        const cleanAssets = assets.map(a => ({ code: a.code.toLowerCase(), type: a.type }));

        // 识别出被删除的资产
        const removedAssets = oldAssets.filter(old => !cleanAssets.some(a => a.code === old.code && a.type === old.type));
        const assetsChanged = removedAssets.length > 0 || cleanAssets.some(c => !oldAssets.some(o => o.code === c.code && o.type === c.type));

        // 直接写入用户独立键，避免竞争冒险
        await writeDoc(userKey, cleanAssets);

        // 更新用户索引
        const index = await readDoc(INDEX_KEY, []);
        if (!index.includes(userId)) {
            index.push(userId);
            await writeDoc(INDEX_KEY, index);
        }

        // 仅在资产结构真正变更时记录日志（避免每分钟轮询都触发 KV 写日志）
        if (assetsChanged) {
            await addSystemLog('INFO', 'Assets', `User ${userId} assets changed (${assets.length} items)`);
        }

        // 核心：清理被删除资产的 KV 数据（必须 await，Workers 不支持 Response 之后的后台任务）
        if (removedAssets.length > 0) {
            await Promise.all(
                removedAssets.map(r => cleanupSingleAssetIfNotUsed(r.type, r.code).catch(() => { }))
            );
        }

        return NextResponse.json({ success: true, cleaned: removedAssets.length });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
