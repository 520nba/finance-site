import { NextResponse } from 'next/server';
import { readDoc, writeDoc } from '@/lib/storage/kvClient';
import { addSystemLog } from '@/lib/storage/logRepo';
import { cleanupSingleAssetIfNotUsed } from '@/lib/storage/maintenanceRepo';

const LEGACY_STORAGE_KEY = 'users_config';
const INDEX_KEY = 'users_index';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ success: false, error: 'Missing userId', code: 'BAD_REQUEST' }, { status: 400 });
    }

    // 1. 尝试读取独立键 (新格式)
    const userKey = `user:assets:${userId}`;
    let userAssets = await readDoc(userKey, null);

    // 2. 如果不存在，尝试从全量配置迁移 (旧格式)
    if (!userAssets) {
        const globalData = await readDoc(LEGACY_STORAGE_KEY, {});
        userAssets = globalData[userId];
        if (userAssets) {
            // 自动触发迁移回填：写入失败只记录错误，不阻止本次数据返回
            // 即：迁移失败时用户仍能看到数据（降级到旧格式读取），下次登录会再次尝试迁移
            let migrated = false;
            try {
                await writeDoc(userKey, userAssets);
                migrated = true;

                // 同时也把 ID 加入索引（只有主写入成功才更新索引）
                const index = await readDoc(INDEX_KEY, []);
                if (!index.includes(userId)) {
                    index.push(userId);
                    await writeDoc(INDEX_KEY, index);
                }
            } catch (migErr) {
                // 迁移写入失败：记录真实错误，避免日志掩盖问题
                console.error(`[Migration] Failed to write new key for user ${userId}:`, migErr?.message);
            }

            if (migrated) {
                await addSystemLog('INFO', 'Assets', `Migrated assets for user ${userId} to independent key`);
            }
        } else {
            userAssets = [];
        }
    }

    return NextResponse.json({ success: true, data: userAssets });
}

export async function POST(request) {
    try {
        const { userId, assets } = await request.json();

        if (!userId) {
            return NextResponse.json({ success: false, error: 'Missing userId', code: 'BAD_REQUEST' }, { status: 400 });
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

        return NextResponse.json({ success: true, data: { cleaned: removedAssets.length } });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
