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

      console.log(\`[Trigger] Cron [\${cron}] triggered. Dispatching \${targetUrls.length} tasks.\`);
      
      const tasks = targetUrls.map(url => 
        fetch(url)
          .then(res => console.log(\`[Trigger] SUCCESS [\${res.status}]: \${url}\`))
          .catch(e => console.error("[Trigger] FAILED:", url, e.message))
      );
      
      ctx.waitUntil(Promise.allSettled(tasks));
    } catch (globalError) {
      console.error("[Trigger] Critical failure in scheduled handler:", globalError.message);
    }
  },`;

    // 更加鲁棒的导出对象匹配
    const exportRegex = /export\s+default\s*\{/;
    const match = content.match(exportRegex);

    if (match) {
      const insertionPoint = match.index + match[0].length;
      content = content.slice(0, insertionPoint) + scheduledFunction + content.slice(insertionPoint);
      fs.writeFileSync(workerPath, content);
      console.log('Successfully patched .open-next/worker.js with robust scheduled() handler');
    } else {
      console.error('Could not find export default in .open-next/worker.js');
    }
  } else {
    console.log('scheduled() handler already exists in .open-next/worker.js');
  }
} else {
  console.error('.open-next/worker.js not found. Make sure to run build first.');
}
