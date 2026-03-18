/**
 * src/app/api/admin/refetch-fund-history/route.js
 * 
 * 涓撶敤鍩洪噾閲嶅埛鎺ュ彛锛岄噰鐢?Streaming (NDJSON) 鍝嶅簲浠ラ槻姝㈣秴鏃跺強鎻愪緵瀹炴椂杩涘害銆?
 */

import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';
import { getD1Storage } from '@/lib/storage/d1Client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5鍒嗛挓闄愭椂

const HISTORY_DAYS = 250;

export async function GET(request) {
    // 1. 閴存潈
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === '1';

    // 2. 鍑嗗鏁版嵁搴?
    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    // 4. 鑾峰彇鎵€鏈夊緟閲嶅埛鍩洪噾鍒楄〃
    const { results: funds } = await db
        .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'fund'")
        .all();

    if (!funds?.length) return NextResponse.json({ ok: true, message: 'No funds found' });

    // 5. 浠诲姟鎶曢€掞細鍐欏叆 D1 sync_jobs 浠诲姟琛?
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
            message: `宸插悜浠诲姟涓績鎶曢€?${funds.length} 鍙熀閲戠殑閲嶅埛璇锋眰`,
            total: funds.length,
            elapsed_ms: elapsed
        });
    } catch (e) {
        console.error('[Admin:Refetch] Task injection failed:', e.message);
        return NextResponse.json({ ok: false, error: '浠诲姟鎶曢€掑け璐? ' + e.message }, { status: 500 });
    }
}
