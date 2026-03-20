/**
 * worker-entry.js
 * 
 * Cloudflare Workers 统一入口 (Refactored for D1 Task Queue)
 */

import openNextWorker from './.open-next/worker.js';
import { runHistorySync } from './lib/cron/historySync.js';
import { runRealtimeSync } from './lib/cron/realtimeSync.js';
import { runSentinel } from './lib/cron/sentinel.js';
import { processSyncJobs } from './lib/queue/jobProcessor.js';

export default {
    fetch(request, env, ctx) {
        return openNextWorker.fetch(request, env, ctx);
    },

    async scheduled(event, env, ctx) {
        console.log(`[Scheduled] Triggered: ${event.cron}`);
        // 记录到 D1 以便在生产环境验证触发情况
        if (env.DB) {
            try {
                await env.DB.prepare('INSERT INTO system_logs (level, module, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
                    .bind('INFO', 'CronTrigger', `Triggered: ${event.cron}`).run();
            } catch (e) {
                console.error('[Scheduled] Failed to log trigger:', e.message);
            }
        }

        switch (event.cron) {
            case '15 14 * * 1-5': // Beijing 22:15
            case '0 19 * * 1-6':  // Beijing 03:00
                ctx.waitUntil(runHistorySync(env));
                break;
            case '*/5 1-7 * * 1-5':
                ctx.waitUntil(runRealtimeSync(env));
                break;
            case '*/15 * * * *':
                ctx.waitUntil(runSentinel(env));
                break;
            case '*/1 * * * *':
                // 切换至 D1 任务中心处理器
                ctx.waitUntil(processSyncJobs(env));
                break;
            default:
                console.warn(`[Scheduled] Unknown cron: "${event.cron}"`);
        }
    },
};
