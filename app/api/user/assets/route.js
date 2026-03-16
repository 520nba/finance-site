import { NextResponse } from 'next/server';
import { getUserAssets, saveUserAssets } from '@/lib/storage/userRepo';
import { cleanupSingleAssetIfNotUsed } from '@/lib/storage/maintenanceRepo';
import { getD1Storage, getCloudflareCtx } from '@/lib/storage/d1Client';
import { syncHistoryBulk } from '@/app/api/history/bulk/route';
import { syncNamesBulk } from '@/app/api/names/bulk/route';
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
        console.error(`[Assets] GET failed for ${userId}:`, e.message);
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

        // 2. 利用 Serverless 异步机制后台静默抓取历史数据与名称
        if (addedAssets.length > 0) {
            const cloudflare = await getCloudflareCtx();
            if (cloudflare?.ctx?.waitUntil) {
                // 利用 ctx.waitUntil 在响应后继续执行抓取任务
                cloudflare.ctx.waitUntil((async () => {
                    try {
                        console.log(`[Assets] Background Sync starting for ${addedAssets.length} new items of ${userId}`);
                        // 同步名称
                        await syncNamesBulk(addedAssets, true);
                        // 同步 250 天历史数据
                        await syncHistoryBulk(addedAssets, 250, true);
                        console.log(`[Assets] Background Sync finished for ${userId}`);
                    } catch (err) {
                        console.error(`[Assets] Background Sync failed for ${userId}:`, err.message);
                    }
                })());
            } else {
                // 非 Edge 环境或不支持 waitUntil 时，还是得稍微挡一下或者忽略（本地开发环境通常不支持 waitUntil）
                console.log(`[Assets] ctx.waitUntil not available, skipping background sync`);
            }
        }

        if (removedAssets.length > 0) {
            // 背景清理
            const cloudflare = await getCloudflareCtx();
            const cleanupTask = Promise.all(
                removedAssets.map(r => cleanupSingleAssetIfNotUsed(r.type, r.code).catch(() => { }))
            );
            if (cloudflare?.ctx?.waitUntil) {
                cloudflare.ctx.waitUntil(cleanupTask);
            }
        }

        return NextResponse.json({ success: true, data: { added: addedAssets.length, removed: removedAssets.length } });
    } catch (e) {
        console.error(`[Assets] POST critical failure for ${userId}:`, e.message);
        return NextResponse.json({
            success: false,
            error: e.message,
            code: 'INTERNAL_ERROR'
        }, { status: 500 });
    }
}

