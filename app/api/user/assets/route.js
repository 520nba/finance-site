import { NextResponse } from 'next/server';
import { readDoc } from '@/lib/storage/kvClient';
import { getUserAssets, saveUserAssets } from '@/lib/storage/userRepo';
import { cleanupSingleAssetIfNotUsed } from '@/lib/storage/maintenanceRepo';

const LEGACY_STORAGE_KEY = 'users_config';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ success: false, error: 'Missing userId', code: 'BAD_REQUEST' }, { status: 400 });
    }

    // 1. 优先从 D1 读取 (新存储)
    let userAssets = await getUserAssets(userId);

    // 2. 如果 D1 为空，尝试从 KV 迁移 (兼容旧格式)
    if (userAssets.length === 0) {
        // 尝试 KV 独立键
        const userKey = `user:assets:${userId}`;
        let kvAssets = await readDoc(userKey, null);

        // 如果独立键也没有，尝试全量配置
        if (!kvAssets) {
            const globalData = await readDoc(LEGACY_STORAGE_KEY, {});
            kvAssets = globalData[userId];
        }

        if (kvAssets && Array.isArray(kvAssets)) {
            userAssets = kvAssets;
            // 触发异步迁移到 D1
            try {
                await saveUserAssets(userId, kvAssets);
                console.log(`[Migration] Migrated user ${userId} assets from KV to D1`);
            } catch (migErr) {
                console.error(`[Migration] D1 migration failed for ${userId}:`, migErr.message);
            }
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

        // 获取旧资产用于比对清理
        const oldAssets = await getUserAssets(userId);
        const cleanAssets = assets.map(a => ({ code: a.code.toLowerCase(), type: a.type }));

        // 识别被删除的资产
        const removedAssets = oldAssets.filter(old => !cleanAssets.some(a => a.code === old.code && a.type === old.type));
        const assetsChanged = removedAssets.length > 0 || cleanAssets.some(c => !oldAssets.some(o => o.code === c.code && o.type === c.type));

        // 写入 D1
        await saveUserAssets(userId, cleanAssets);

        if (assetsChanged) {
            console.log(`[Assets] User ${userId} assets updated in D1 (${assets.length} items)`);
        }

        // 清理被删除资产的冗余数据
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
