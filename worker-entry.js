/**
 * worker-entry.js
 *
 * Cloudflare Workers 统一入口。
 *
 * fetch handler     → 透传给 open-next，处理所有 Next.js HTTP 请求
 * scheduled handler → 按 event.cron 字符串精确分流到对应任务
 *
 * 重要：open-next 生成的 worker.js 只导出 fetch handler，
 * scheduled event 无法被其捕获，必须在本文件单独声明。
 * wrangler.toml 的 main 字段须指向本文件。
 */

import openNextWorker from './.open-next/worker.js';
import { runHistorySync } from './lib/cron/historySync.js';
import { runRealtimeSync } from './lib/cron/realtimeSync.js';
import { runSentinel } from './lib/cron/sentinel.js';

export default {
    // ── HTTP：全部交给 open-next ──────────────────────────────────────────────
    fetch(request, env, ctx) {
        return openNextWorker.fetch(request, env, ctx);
    },

    // ── Cron：按表达式字符串精确路由 ─────────────────────────────────────────
    //
    // event.cron 值与 wrangler.toml [triggers].crons 里的字符串完全一致，
    // 可直接用 switch/case 匹配，无需正则解析。
    async scheduled(event, env, ctx) {
        switch (event.cron) {

            // 历史数据增量同步：每个交易日收盘后 21:00，次日凌晨 03:00 补跑
            case '0 13 * * 1-5':
            case '0 19 * * 1-6':
                ctx.waitUntil(runHistorySync(env));
                break;

            // 盘中实时行情抓取：周一到周五 09:00-15:55（北京时间），每 5 分钟
            case '*/5 1-7 * * 1-5':
                ctx.waitUntil(runRealtimeSync(env));
                break;

            // 外部接口健康巡检：每 15 分钟全天候运行
            case '*/15 * * * *':
                ctx.waitUntil(runSentinel(env));
                break;

            default:
                console.warn(`[Scheduled] Unknown cron: "${event.cron}"`);
        }
    },
};
