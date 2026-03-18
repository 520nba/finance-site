/**
 * src/app/api/admin/refetch-fund-history/route.js
 * 
 * 专用基金重刷接口，采�?Streaming (NDJSON) 响应以防止超时及提供实时进度�?
 */

import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
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

    // 2. 准备数据�?
    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    // 4. 获取所有待重刷基金列表
    const { results: funds } = await db
        .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'fund'")
        .all();

    if (!funds?.length) return NextResponse.json({ ok: true, message: 'No funds found' });

    // 5. 任务投递：写入 D1 sync_jobs 任务�?
    const t0 = Date.now();
    try {
        const stmts = funds.map(f =>
            db.prepare(`
                INSERT INTO sync_jobs (type, code, payload, status) 
                VALUES (?, ?, ?, 'pending')
            `).bind('fund_history', f.code.toLowerCase(), JSON.stringify({ force }))
        );

        await db.batch(stmts);

        const elapsed = Date.now() - t0;
        return NextResponse.json({
            ok: true,
            message: `已向任务中心投�?${funds.length} 只基金的重刷请求`,
            total: funds.length,
            elapsed_ms: elapsed
        });
    } catch (e) {
        console.error('[Admin:Refetch] Task injection failed:', e.message);
        return NextResponse.json({ ok: false, error: '任务投递失�? ' + e.message }, { status: 500 });
    }
}
