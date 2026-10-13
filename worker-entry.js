/**
 * worker-entry.js
 *
 * Cloudflare Workers 统一入口
 *
 * 调度：免费版每账户只有 5 个 Cron Trigger，因此这里只用 2 条表达式，
 * 由 lib/cron/dispatch.js 按北京时间在内部分发（详见该文件注释）。
 */

import openNextWorker from './.open-next/worker.js';
import { runHistorySync } from './lib/cron/historySync.js';
import { runRealtimeSync } from './lib/cron/realtimeSync.js';
import { runSentinel } from './lib/cron/sentinel.js';
import { processSyncJobs } from './lib/queue/jobProcessor.js';
import { pickTasks } from './lib/cron/dispatch.js';
import { getBeijingDate } from './lib/utils.js';

export default {
    fetch(request, env, ctx) {
        return openNextWorker.fetch(request, env, ctx);
    },

    async scheduled(event, env, ctx) {
        const tasks = pickTasks(getBeijingDate(), event.cron);
        console.log(`[Scheduled] cron="${event.cron}" tasks=[${tasks.join(',')}]`);

        for (const task of tasks) {
            switch (task) {
                case 'queue':
                    ctx.waitUntil(processSyncJobs(env));
                    break;
                case 'sentinel':
                    ctx.waitUntil(runSentinel(env));
                    break;
                case 'realtime':
                    ctx.waitUntil(runRealtimeSync(env));
                    break;
                case 'history-full':
                    ctx.waitUntil(runHistorySync(env));
                    break;
                case 'history-missing':
                    ctx.waitUntil(runHistorySync(env, { onlyMissing: true }));
                    break;
                default:
                    console.warn(`[Scheduled] Unknown task: ${task}`);
            }
        }
    },
};
