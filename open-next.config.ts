import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
    scheduled: {
        handle: async (event, env, ctx) => {
            // 将 Cloudflare Cron 事件转发到内部 API 路由
            // 由于 OpenNext 内部通常不暴露私有密钥，我们通过 env.CRON_SECRET 鉴权
            const url = `http://localhost/api/cron/sync?token=${env.CRON_SECRET || ''}`;
            const request = new Request(url, {
                headers: {
                    'x-forwarded-host': 'localhost'
                }
            });
            await env.ASSETS.fetch(request);
        }
    }
});
