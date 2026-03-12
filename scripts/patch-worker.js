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
      const rawCron = event.cron || "";
      const normalizedCron = rawCron.replace(/\s+/g, ' ').trim();
      const secret = env.CRON_SECRET || "";
      
      // 1. 严格路由映射 (Strict Mapping)
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

      // 2. 增强型负载判定 (Resilient Lookup)
      const paths = routes[rawCron] || routes[normalizedCron] || routes["*/10 * * * *"];

      console.log(\`[Trigger] Cron [\${normalizedCron}] Dispatching \${paths.length} tasks via Direct Invocation.\`);
      
      // 3. 内存级直调 (Zero-Network Subrequest)
      // 跳过网络栈，直触 Worker 内部逻辑，规避一切回环寻址问题
      const tasks = paths.map(async path => {
        try {
          const req = new Request(\`http://internal\${path}\`, {
             headers: { "x-internal-cron": "true" }
          });
          // @ts-ignore - this.fetch refers to the main fetch handler in OpenNext worker export
          const res = await this.fetch(req, env, ctx);
          const body = await res.text();
          console.log(\`[Trigger] SUCCESS [\${res.status}]: \${path} -> \${body.slice(0, 50)}\`);
        } catch (e) {
          console.error(\`[Trigger] INTERNAL_INVOCATION_FAILED: \${path} -> \${e.message}\`);
        }
      });
      
      // 在 scheduled 事件中直接 await 任务池即可
      await Promise.all(tasks); 
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
