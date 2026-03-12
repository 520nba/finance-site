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
      const baseUrl = "https://finance.380220.xyz";
      const secret = env.CRON_SECRET || "";
      
      let targetUrls = [];
      if (cron === "*/10 * * * *") {
        targetUrls = [\`\${baseUrl}/api/cron/health?token=\${secret}\`];
      } else if (cron === "0 13 * * 1-5") {
        targetUrls = [\`\${baseUrl}/api/cron/daily?token=\${secret}\`];
      } else if (cron === "*/5 1-7 * * 1-5") {
        targetUrls = [\`\${baseUrl}/api/cron/sync?token=\${secret}\`];
      } else {
        targetUrls = [\`\${baseUrl}/api/cron/health?token=\${secret}\`, \`\${baseUrl}/api/cron/sync?token=\${secret}\`];
      }

      console.log(\`[Trigger] Cron [\${cron}] Dispatching \${targetUrls.length} tasks.\`);
      
      const tasks = targetUrls.map(async url => {
        try {
          const res = await fetch(url);
          const body = await res.text();
          const log = \`[Trigger] SUCCESS [\${res.status}]: \${url} -> \${body.slice(0, 100)}\`;
          console.log(log);
          return log;
        } catch (e) {
          const err = \`[Trigger] FAILED: \${url} -> \${e.message}\`;
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
