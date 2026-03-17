/**
 * src/app/api/admin/refetch-fund-history/route.js
 * 
 * 专用基金重刷接口，采用 Streaming (NDJSON) 响应以防止超时及提供实时进度。
 */

import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/storage/authRepo';
import { fetchFundHistory } from '@/lib/services/historyFetcher';
import { insertDailyPricesBatch, deleteAssetHistory } from '@/lib/storage/historyRepo';
import { getD1Storage } from '@/lib/storage/d1Client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5分钟限时

const HISTORY_DAYS = 250;

export async function GET(request) {
    // 1. 鉴权
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === '1';

    // 2. 准备数据库
    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    // 3. 获取 KV 绑定 (由 Cloudflare 提供)
    // 注意：在 Next.js Edge Runtime 中，env 绑定通常通过 process.env 或 requestContext 获取
    // 这里我们假设通过全局注入或 env 参数获取，实际由 Worker 环境确保 FUND_QUEUE 可用
    const FUND_QUEUE = process.env.FUND_QUEUE;
    if (!FUND_QUEUE) {
        return NextResponse.json({ error: 'FUND_QUEUE KV 未绑定，请检查 Cloudflare 配置' }, { status: 500 });
    }

    // 4. 获取所有待重刷基金列表
    const { results: funds } = await db
        .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'fund'")
        .all();

    if (!funds?.length) return NextResponse.json({ ok: true, message: 'No funds found' });

    // 5. 任务投递：将重刷需求写入 KV 队列
    const t0 = Date.now();
    let submittedCount = 0;
    const errors = [];

    // 分批次投递以防 API 超时
    const writes = funds.map(async (f) => {
        try {
            const key = `fund:${f.code.toLowerCase()}`;
            await FUND_QUEUE.put(key, JSON.stringify({
                status: 'pending',
                retry: 0,
                force: force,
                updatedAt: Date.now()
            }));
            submittedCount++;
        } catch (e) {
            errors.push(`${f.code}: ${e.message}`);
        }
    });

    await Promise.all(writes);

    const elapsed = Date.now() - t0;
    return NextResponse.json({
        ok: true,
        message: `已将 ${submittedCount} 只基金投递至后端异步队列`,
        total: funds.length,
        submitted: submittedCount,
        errors: errors.length ? errors : undefined,
        elapsed_ms: elapsed
    });
}
