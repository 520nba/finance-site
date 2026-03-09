import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
    scheduled: {
        handle: async (event, env, ctx) => {
            // 将 Cloudflare Cron 事件转发到内部 API 路由
            // 使用 env.ASSETS.fetch 进行内部子请求，这是 OpenNext 触发内部 API 的推荐方式
            const url = `http://localhost/api/cron/sync?token=${env.CRON_SECRET || ''}`;
            const request = new Request(url, {
                headers: {
                    'x-forwarded-host': 'localhost'
                }
            });
            const response = await env.ASSETS.fetch(request);
            console.log(`[Cron] Internal Sync status: ${response.status}`);
        }
    }
});
