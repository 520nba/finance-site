/**
 * src/app/api/cron/sync/route.js
 *
 * 手动触发盘中实时行情同步的 HTTP 调试入口。
 * 正式生产由 wrangler.toml cron + scheduled handler 驱动，本文件仅供调试。
 *
 * 调用方式（**鉴权只走请求头**）：
 *   curl -H "x-admin-key: $ADMIN_API_KEY"     "…/api/cron/sync?task=realtime"
 *   curl -H "x-admin-session: <sessionToken>" "…/api/cron/sync?task=history"
 *   task 取值：realtime（默认）/ history / sentinel
 *
 * ⚠️ 不要再使用 `?key=…`：管理员密钥是全局 PSK，一旦经 URL 传递就会落进
 * Cloudflare Workers 日志、浏览器历史与 Referer（adminAuth 已移除 query 鉴权）。
 */

import { NextResponse } from 'next/server';
import { runHistorySync } from '@/lib/cron/historySync';
import { runRealtimeSync } from '@/lib/cron/realtimeSync';
import { runSentinel } from '@/lib/cron/sentinel';
import { isAdminAuthorized } from '@/lib/auth/adminAuth';

export const dynamic = 'force-dynamic';

const TASK_MAP = {
    history: runHistorySync,
    realtime: runRealtimeSync,
    sentinel: runSentinel,
};

/** 取真实 Worker 绑定（原先这里伪造了 { DB }，一旦 runner 需要别的绑定就会静默拿到 undefined） */
async function resolveEnv() {
    try {
        const { getCloudflareContext } = await import('@opennextjs/cloudflare');
        const ctx = await getCloudflareContext();
        if (ctx?.env) return ctx.env;
    } catch (e) {
        console.error('[CronRoute] env resolve failed:', e.message);
    }
    const { getD1Storage } = await import('@/lib/storage/d1Client');
    return { DB: await getD1Storage() };
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const env = await resolveEnv();

    // ── 鉴权：统一使用管理员校验（带真实 env，避免依赖 context 回退）──
    if (!(await isAdminAuthorized(request, env))) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // ── 路由 ────────────────────────────────────────────────────────────────
    const task = searchParams.get('task') ?? 'realtime';
    const runner = TASK_MAP[task];

    if (!runner) {
        return NextResponse.json(
            { success: false, error: `Unknown task "${task}". Valid: ${Object.keys(TASK_MAP).join(', ')}` },
            { status: 400 }
        );
    }

    // ── 执行 ────────────────────────────────────────────────────────────────
    try {
        const t0 = Date.now();
        const force = searchParams.get('force') === '1';
        const type = searchParams.get('type');
        await runner(env, { force, type });
        const elapsed = Date.now() - t0;
        return NextResponse.json({ success: true, task, force, type, elapsed_ms: elapsed });
    } catch (e) {
        console.error(`[CronRoute] task=${task} failed:`, e.stack || e.message);
        return NextResponse.json({ success: false, task, error: 'internal_error' }, { status: 500 });
    }
}
