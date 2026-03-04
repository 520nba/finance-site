import { NextResponse } from 'next/server';
import { getUserAssets, saveUserAssets } from '@/lib/storage/userRepo';
import { cleanupSingleAssetIfNotUsed } from '@/lib/storage/maintenanceRepo';
import { getD1Storage } from '@/lib/storage/d1Client';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ success: false, error: 'Missing userId', code: 'BAD_REQUEST' }, { status: 400 });
    }

    // [100% D1-Only] 仅从 D1 读取，不再向 KV 回退
    // 这样用户删除资产后，D1 为空即为空，不会再从旧 KV “复活”数据
    const userAssets = await getUserAssets(userId);
    return NextResponse.json({ success: true, data: userAssets });
}

export async function POST(request) {
    let currentUserId = 'unknown';
    try {
        const payload = await request.json();
        const { userId, assets } = payload || {};
        currentUserId = userId || 'unknown';

        if (!userId) {
            return NextResponse.json({ success: false, error: 'Missing userId', code: 'BAD_REQUEST' }, { status: 400 });
        }

        // [Robustness] 检查 D1 连通性
        const db = await getD1Storage();
        if (!db) {
            return NextResponse.json({ success: false, error: 'Database unavailable', code: 'D1_UNAVAILABLE' }, { status: 503 });
        }

        // 获取旧资产用于比对清理
        const oldAssets = await getUserAssets(userId);

        // [Defensive] 数据清洗与排除无效项
        const cleanAssets = (Array.isArray(assets) ? assets : [])
            .filter(a => a && a.code && a.type)
            .map(a => ({ code: String(a.code).toLowerCase(), type: a.type }));

        const removedAssets = oldAssets.filter(old => !cleanAssets.some(a => a.code === old.code && a.type === old.type));
        const assetsChanged = removedAssets.length > 0 || cleanAssets.some(c => !oldAssets.some(o => o.code === c.code && o.type === c.type));

        // 写入 D1
        await saveUserAssets(userId, cleanAssets);

        if (assetsChanged) {
            console.log(`[Assets] User ${userId} assets updated in D1 (${cleanAssets.length} items)`);
        }

        // 立即执行清理 (pulse-less)
        if (removedAssets.length > 0) {
            await Promise.all(
                removedAssets.map(r => cleanupSingleAssetIfNotUsed(r.type, r.code).catch(() => { }))
            );
        }

        return NextResponse.json({ success: true, data: { cleaned: removedAssets.length } });
    } catch (e) {
        console.error(`[Assets] POST critical failure for ${currentUserId}:`, e.message);
        return NextResponse.json({
            success: false,
            error: e.message,
            stack: e.stack,
            code: 'INTERNAL_ERROR'
        }, { status: 500 });
    }
}
