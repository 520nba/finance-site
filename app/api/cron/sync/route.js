/**
 * src/app/api/cron/sync/route.js
 *
 * 手动触发盘中实时行情同步的 HTTP 调试入口。
 * 正式生产由 wrangler.toml cron + scheduled handler 驱动，本文件仅供调试。
 *
 * 调用方式：
 *   GET /api/cron/sync?task=realtime&secret=YOUR_SECRET
 *   GET /api/cron/sync?task=history&secret=YOUR_SECRET
 *   GET /api/cron/sync?task=sentinel&secret=YOUR_SECRET
 *
 * 环境变量：
 *   CRON_SECRET  调用密钥，必须配置，否则非生产环境也拒绝访问
 */

import { NextResponse }     from 'next/server';
import { runHistorySync }   from '@/lib/cron/historySync';
import { runRealtimeSync }  from '@/lib/cron/realtimeSync';
import { runSentinel }      from '@/lib/cron/sentinel';

export const dynamic = 'force-dynamic';

const TASK_MAP = {
    history:  runHistorySync,
    realtime: runRealtimeSync,
    sentinel: runSentinel,
};

export async function GET(request) {
    // ── 鉴权 ────────────────────────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');

    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
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
    // Next.js route handler 无法直接访问 env.DB（D1 binding 只在 Workers runtime 可用）
    // 此处通过 process.env.__D1_BINDING__ 或全局 DB 获取，具体取决于 open-next 的注入方式。
    // 推荐做法：在 next.config.js 或 d1Client.js 中统一封装 DB 获取逻辑。
    const env = { DB: globalThis.__D1_BINDING__ ?? process.env.DB };

    try {
        const t0 = Date.now();
        await runner(env);
        const elapsed = Date.now() - t0;
        return NextResponse.json({ success: true, task, elapsed_ms: elapsed });
    } catch (e) {
        console.error(`[CronRoute] task=${task} failed:`, e.message);
        return NextResponse.json({ success: false, task, error: e.message }, { status: 500 });
    }
}
