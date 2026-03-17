import { NextResponse } from 'next/server';
import { getUserAssets, saveUserAssets } from '@/lib/storage/userRepo';
import { cleanupSingleAssetIfNotUsed } from '@/lib/storage/maintenanceRepo';
import { getD1Storage, getCloudflareCtx } from '@/lib/storage/d1Client';
import { syncHistoryBulk, syncNamesBulk } from '@/lib/services/assetSyncService';
import { requireUser } from '@/lib/auth/requireUser';

const MAX_ASSETS_PER_USER = 100;

export async function GET(request) {
    const userId = await requireUser(request);

    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    try {
        const userAssets = await getUserAssets(userId);
        return NextResponse.json({ success: true, data: userAssets });
    } catch (e) {
        console.error(`[Assets] GET failed for ${userId}: `, e.message);
        return NextResponse.json({ success: false, error: e.message, code: 'D1_ERROR' }, { status: 503 });
    }
}

export async function POST(request) {
    const userId = await requireUser(request);
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    try {
        const payload = await request.json();
        const { assets } = payload || {};

        const db = await getD1Storage();
        if (!db) {
            return NextResponse.json({ success: false, error: 'Database unavailable', code: 'D1_UNAVAILABLE' }, { status: 503 });
        }

        const oldAssets = await getUserAssets(userId);
        const cleanAssets = (Array.isArray(assets) ? assets : [])
            .filter(a => a && a.code && a.type)
            .map(a => ({ code: String(a.code).toLowerCase(), type: a.type }));

        if (cleanAssets.length > MAX_ASSETS_PER_USER) {
            return NextResponse.json({
                success: false,
                error: `Tracking limit reached: max ${MAX_ASSETS_PER_USER} assets per account`,
                code: 'QUOTA_EXCEEDED'
            }, { status: 400 });
        }

        const addedAssets = cleanAssets.filter(c => !oldAssets.some(o => o.code === c.code && o.type === c.type));
        const removedAssets = oldAssets.filter(old => !cleanAssets.some(a => a.code === old.code && a.type === old.type));

        // 1. 优先写入资产基础关联
        await saveUserAssets(userId, cleanAssets);

        // 2. 检查并补全资产名称 (D1 维护)
        const nameResults = await syncNamesBulk(cleanAssets);

        // 2. 架构减负：移除原本笨重的 ctx.waitUntil 历史抓取逻辑。
        // 现在抓取压力由前端 useAssetSync 识别数据空洞并分片发起请求。
        // 这里仅辅助触发轻量级的名称预热（可选）或直接返回告知前端哪些是新增的。

        if (removedAssets.length > 0) {
            // 背景清理 (保留轻量级清理任务)
            const cloudflare = await getCloudflareCtx();
            const cleanupTask = Promise.all(
                removedAssets.map(r => cleanupSingleAssetIfNotUsed(r.type, r.code).catch(() => { }))
            );
            if (cloudflare?.ctx?.waitUntil) {
                cloudflare.ctx.waitUntil(cleanupTask);
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                added: addedAssets.map(a => ({ code: a.code, type: a.type })),
                removedCount: removedAssets.length
            }
        });
    } catch (e) {
        console.error(`[Assets] POST critical failure for ${userId}: `, e.message);
        return NextResponse.json({
            success: false,
            error: e.message,
            code: 'INTERNAL_ERROR'
        }, { status: 500 });
    }
}

