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
import { fetchFundHistory } from './lib/services/historyFetcher.js';
import { insertDailyPricesBatch } from './lib/storage/historyRepo.js';

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

            // 基金异步重刷队列处理器：每分钟运行
            case '*/1 * * * *':
                ctx.waitUntil(processFundQueue(env));
                break;

            default:
                console.warn(`[Scheduled] Unknown cron: "${event.cron}"`);
        }
    },
};

/**
 * 基金异步重刷队列处理器
 * 职责：分批从 KV 抓取 Pending 任务，执行抓取并写入 D1
 */
async function processFundQueue(env) {
    const BATCH_SIZE = 5; // 每次处理 5 个，防止超时和配额溢出
    const QUEUE = env.FUND_QUEUE;
    const DB = env.DB;

    if (!QUEUE) {
        console.error('[Queue] FUND_QUEUE KV not bound');
        return;
    }

    // 1. 获取所有基金任务
    const list = await QUEUE.list({ prefix: 'fund:' });
    if (!list.keys.length) return;

    // 2. 取前 N 个任务
    const tasks = list.keys.slice(0, BATCH_SIZE);

    for (const keyObj of tasks) {
        const keyName = keyObj.name;
        const raw = await QUEUE.get(keyName);
        if (!raw) continue;

        const job = JSON.parse(raw);
        const code = keyName.split(':')[1];

        // 防死锁：如果处于 processing 状态且更新时间在 5 分钟内，跳过
        if (job.status === 'processing' && (Date.now() - job.updatedAt < 300000)) {
            continue;
        }

        try {
            // 标记为正在处理
            await QUEUE.put(keyName, JSON.stringify({
                ...job,
                status: 'processing',
                updatedAt: Date.now()
            }));

            console.log(`[Queue] Processing ${code} (force=${job.force})`);

            // 抓取历史 (250天)
            const history = await fetchFundHistory(code, 250);
            if (!history?.length) {
                // 如果抓取失败且重试次数未超限，标记为 pending 等待下次
                if ((job.retry || 0) < 3) {
                    await QUEUE.put(keyName, JSON.stringify({
                        ...job,
                        status: 'pending',
                        retry: (job.retry || 0) + 1,
                        updatedAt: Date.now()
                    }));
                } else {
                    // 超限则放弃
                    await QUEUE.delete(keyName);
                    console.error(`[Queue] Max retries reached for ${code}, dropped.`);
                }
                continue;
            }

            // 写入 D1
            if (job.force) {
                // 强制模式：先删后写
                await DB.prepare('DELETE FROM asset_history WHERE code = ? AND type = ?').bind(code.toLowerCase(), 'fund').run();
            }

            // 执行分片写入 (historyRepo.js 的 insertDailyPricesBatch 逻辑)
            await insertDailyPricesBatch(
                history.map(r => ({ code, type: 'fund', price: r.value, date: r.date })),
                env
            );

            // 成功后从队列移除
            await QUEUE.delete(keyName);
            console.log(`[Queue] Successfully completed ${code}`);

        } catch (e) {
            console.error(`[Queue] Error processing ${code}:`, e.message);
            // 发生异常，回退到 pending
            await QUEUE.put(keyName, JSON.stringify({
                ...job,
                status: 'pending',
                retry: (job.retry || 0) + 1,
                updatedAt: Date.now()
            }));
        }
    }
}
