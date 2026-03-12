import fs from 'node:fs';
import path from 'node:path';

const workerPath = path.resolve('.open-next/worker.js');

if (fs.existsSync(workerPath)) {
  let content = fs.readFileSync(workerPath, 'utf8');

  // 检查是否已经包含了 scheduled
  if (!content.includes('async scheduled')) {
    const scheduledFunction = `
  async scheduled(event, env, ctx) {
    try {
      const cron = (event.cron || "").replace(/\s+/g, ' ').trim();
      const secret = env.CRON_SECRET || "";
      
      // 1. 严格路由映射与 Fallback 逻辑
      const routes = {
        "*/10 * * * *": [
          \`/api/cron/health?token=\${secret}\`,
          \`/api/cron/sync?token=\${secret}\`
        ],
        "0 13 * * 1-5": [
          \`/api/cron/daily?token=\${secret}\`,
          \`/api/cron/sync?token=\${secret}\`
        ],
        "0 19 * * 1-6": [
          \`/api/cron/sync?token=\${secret}\`
        ],
        "*/5 1-7 * * 1-5": [
          \`/api/cron/sync?token=\${secret}\`
        ]
      };

      // 如果找不到匹配的 Cron，默认回退到例行同步与巡检
      const paths = routes[cron] || routes["*/10 * * * *"];

      console.log(\`[Trigger] Cron [\${cron}] Dispatching \${paths.length} tasks.\`);
      
      // 2. 将所有内部请求封装为异步任务池
      const tasks = paths.map(async path => {
        try {
          // 使用 localhost 内部调用，无视外部公网延迟
          const url = \`http://localhost\${path}\`;
          const res = await fetch(url, {
             headers: { "x-internal-cron": "true" }
          });
          const body = await res.text();
          console.log(\`[Trigger] SUCCESS [\${res.status}]: \${path} -> \${body.slice(0, 100)}\`);
        } catch (e) {
          console.error(\`[Trigger] FAILED: \${path} -> \${e.message}\`);
        }
      });
      
      // 3. 正确管理 Worker 生命周期 (Cloudflare 推荐实践)
      const job = Promise.all(tasks);
      ctx.waitUntil(job);
      await job; 
    } catch (globalError) {
      console.error(\`[Trigger] Critical failure: \${globalError.message}\`);
    }
  },`;

    // 更加鲁棒的导出对象匹配
    const exportRegex = /export\s+default\s*\{/;
    const match = content.match(exportRegex);

    if (match) {
      const insertionPoint = match.index + match[0].length;
      content = content.slice(0, insertionPoint) + scheduledFunction + content.slice(insertionPoint);

      // 在 fetch 句柄的最前面增加调试路由
      const fetchStartRegex = /async\s+fetch\s*\(request,\s*env,\s*ctx\)\s*\{/;
      const fetchMatch = content.match(fetchStartRegex);
      if (fetchMatch) {
        const debugRoute = `
    const debugUrl = new URL(request.url);
    if (debugUrl.pathname === "/__manual_scheduled") {
       // 安全第一：手动触发必须校验 token
       if (debugUrl.searchParams.get("token") !== env.CRON_SECRET) {
          console.warn("[Debug] Unauthorized access attempt to /__manual_scheduled");
          return new Response("Unauthorized", { status: 401 });
       }
       console.log("[Debug] Manually triggering scheduled handler via /__manual_scheduled");
       const cron = debugUrl.searchParams.get("cron") || "*/10 * * * *";
       // @ts-ignore - Trigger internal handler
       await this.scheduled({ cron }, env, ctx);
       return new Response(JSON.stringify({ 
         success: true, 
         message: "Manual Scheduled Triggered Successfully"
       }, null, 2), { 
         status: 200,
         headers: { "Content-Type": "application/json" }
       });
    }
`;
        const fetchInsertionPoint = fetchMatch.index + fetchMatch[0].length;
        content = content.slice(0, fetchInsertionPoint) + debugRoute + content.slice(fetchInsertionPoint);
      }

      fs.writeFileSync(workerPath, content);
      console.log('Successfully patched .open-next/worker.js with robust scheduled() handler and debug route');
    } else {
      console.error('Could not find export default in .open-next/worker.js');
    }
  } else {
    console.log('scheduled() handler already exists in .open-next/worker.js');
  }
} else {
  console.error('.open-next/worker.js not found. Make sure to run build first.');
}
