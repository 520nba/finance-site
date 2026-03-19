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
        const db = env?.DB;
        const items = [{ code, type }];

        // 1. 先读 D1，如果已有完整数据直接返回，避免重复投队列
        const [nameMap, histResult] = await Promise.all([
            syncNamesBulk(items, false),
            syncHistoryBulk(items, 250, false, env),
        ]);

        const histKey = `${type}:${code}`;
        const hasName = nameMap[histKey] && nameMap[histKey] !== code;
        const hasHistory = histResult[histKey]?.history?.length > 0;

        if (hasName && hasHistory) {
            // D1 已有数据，直接返回，不投队列
            return NextResponse.json({ success: true, code, type, source: 'cache' });
        }

        // 2. D1 缺数据时，向任务队列投递补数据任务
        if (!db) {
            return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 503 });
        }

        const jobType = type === 'fund' ? 'fund_history' : 'asset_history_sync';
        const stmts = [];

        if (!hasHistory) {
            stmts.push(
                db.prepare(`
                    INSERT INTO sync_jobs (type, code, payload, status)
                    VALUES (?, ?, ?, 'pending')
                    ON CONFLICT(code, type) WHERE status = 'pending'
                    DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                `).bind(jobType, code.toLowerCase(), JSON.stringify({ type, force: true }))
            );
        }

        if (stmts.length > 0) {
            await db.batch(stmts);
        }

        return NextResponse.json({
            success: true,
            code,
            type,
            source: 'queued',         // 告知前端任务已投队列
            hasName,
            hasHistory,
        });
    } catch (e) {
        console.error(`[SyncAsset] Failed for ${userId}:`, e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
