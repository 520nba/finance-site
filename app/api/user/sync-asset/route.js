import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/requireUser';
import { syncNamesBulk, syncHistoryBulk } from '@/lib/services/assetSyncService';
import { getCloudflareCtx } from '@/lib/storage/d1Client';

/**
 * 前端分片同步接口：同步单只资产的名称与历史数据
 * 职责：被前端 useAssetSync Hook 循环调用，将原本后台的大任务拆分为轻量级的 HTTP 分片
 */
export async function POST(request) {
    const userId = await requireUser(request);
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { code, type } = await request.json();
        if (!code || !type) {
            return NextResponse.json({ success: false, error: 'Invalid parameters' }, { status: 400 });
        }

        const cfCtx = await getCloudflareCtx();
        const env = cfCtx?.env || null;
        const items = [{ code, type }];

        // 1. 同步名称 (禁用外部抓取，仅读 D1)
        await syncNamesBulk(items, false);

        // 2. 同步 250 天历史数据 (禁用外部抓取，仅读 D1)
        await syncHistoryBulk(items, 250, false, env);

        return NextResponse.json({ success: true, code, type });
    } catch (e) {
        console.error(`[SyncAsset] Failed for ${userId}:`, e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
