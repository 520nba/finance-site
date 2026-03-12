import fs from 'node:fs';
import path from 'node:path';

const workerPath = path.resolve('.open-next/worker.js');

if (fs.existsSync(workerPath)) {
  let content = fs.readFileSync(workerPath, 'utf8');

  // 检查是否已经包含了 scheduled
  if (!content.includes('async scheduled')) {
    const scheduledFunction = `
  async scheduled(event, env, ctx) {
    const results = [];
    try {
      const cron = event.cron;
      const secret = env.CRON_SECRET || "";
      
      const cronMatch = cron.replace(/\s+/g, ' ').trim();
      
      let paths = [];
      if (cronMatch === "*/10 * * * *" || cronMatch === "*/10 * * * *") {
        // 每 10 分钟运行一次：健康检查 + 少量同步 (均衡负载)
        paths = [\`/api/cron/health?token=\${secret}\`, \`/api/cron/sync?token=\${secret}\`];
      } else if (cronMatch.includes("0 13") || cronMatch.includes("0 19")) {
        // 每日全量调度
        paths = [\`/api/cron/daily?token=\${secret}\`, \`/api/cron/sync?token=\${secret}\`];
      } else if (cronMatch.includes("*/5")) {
        // 高频同步时段
        paths = [\`/api/cron/sync?token=\${secret}\`];
      } else {
        // 默认全量
        paths = [\`/api/cron/health?token=\${secret}\`, \`/api/cron/sync?token=\${secret}\`];
      }

      console.log(\`[Trigger] Cron [\${cron}] Dispatching \${paths.length} tasks internally.\`);
      
      const tasks = paths.map(async path => {
        try {
          // 使用 internal fetch (this.fetch) 绕过公网 DNS/SSL 和 Loopback 522 限制
          const url = \`http://localhost\${path}\`;
          const req = new Request(url, {
             headers: { "x-internal-cron": "true" }
          });
          // @ts-ignore
          const res = await this.fetch(req, env, ctx);
          const body = await res.text();
          const log = \`[Trigger] SUCCESS [\${res.status}]: \${path} -> \${body.slice(0, 100)}\`;
          console.log(log);
          return log;
        } catch (e) {
          const err = \`[Trigger] FAILED: \${path} -> \${e.message}\`;
          console.error(err);
          return err;
        }
      });
      
      const taskResults = await Promise.all(tasks);
      results.push(...taskResults);
      ctx.waitUntil(Promise.resolve(taskResults));
    } catch (globalError) {
      const gErr = \`[Trigger] Critical failure: \${globalError.message}\`;
      console.error(gErr);
      results.push(gErr);
    }
    return results;
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
       console.log("[Debug] Manually triggering scheduled handler via /__manual_scheduled");
       const cron = debugUrl.searchParams.get("cron") || "*/10 * * * *";
       // @ts-ignore
       const results = await this.scheduled({ cron }, env, ctx);
       return new Response(JSON.stringify({ 
         success: true, 
         message: "Scheduled Triggered", 
         results,
         secretSet: !!env.CRON_SECRET
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
