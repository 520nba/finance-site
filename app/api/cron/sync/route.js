/**
 * src/app/api/cron/sync/route.js
 *
 * 手动触发盘中实时行情同步的 HTTP 调试入口。
 * 正式生产由 wrangler.toml cron + scheduled handler 驱动，本文件仅供调试。
 *
 * 调用方式：
 *   GET /api/cron/sync?task=realtime&key=YOUR_SECRET
 *   GET /api/cron/sync?task=history&key=YOUR_SECRET
 *
 * 鉴权：
 *   统一通过 isAdminAuthorized 进行校验（支持 Session Token 或 ?key=xxx）
 */

import { NextResponse } from 'next/server';
import { runHistorySync } from '@/lib/cron/historySync';
import { runRealtimeSync } from '@/lib/cron/realtimeSync';
import { runSentinel } from '@/lib/cron/sentinel';
import { isAdminAuthorized } from '@/lib/storage/authRepo';

export const dynamic = 'force-dynamic';

const TASK_MAP = {
    history: runHistorySync,
    realtime: runRealtimeSync,
    sentinel: runSentinel,
};

export async function GET(request) {
    // ── 鉴权：统一使用管理员校验 ───────────────────────────────────────
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // ── 路由 ────────────────────────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const task = searchParams.get('task') ?? 'realtime';
    const runner = TASK_MAP[task];

    if (!runner) {
        return NextResponse.json(
            { success: false, error: `Unknown task "${task}". Valid: ${Object.keys(TASK_MAP).join(', ')}` },
            { status: 400 }
        );
    }

    // ── 执行 ────────────────────────────────────────────────────────────────
    // 统合规范：直接使用 getD1Storage() 获取绑定，支持 context 与 global 注入
    const { getD1Storage } = await import('@/lib/storage/d1Client');
    const db = await getD1Storage();
    const env = { DB: db };

    try {
        const t0 = Date.now();
        const force = searchParams.get('force') === '1';
        await runner(env, { force });
        const elapsed = Date.now() - t0;
        return NextResponse.json({ success: true, task, force, elapsed_ms: elapsed });
    } catch (e) {
        console.error(`[CronRoute] task=${task} failed:`, e.message);
        return NextResponse.json({ success: false, task, error: e.message }, { status: 500 });
    }
}
