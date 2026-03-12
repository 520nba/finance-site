import fs from 'node:fs';
import path from 'node:path';

const workerPath = path.resolve('.open-next/worker.js');

if (fs.existsSync(workerPath)) {
  let content = fs.readFileSync(workerPath, 'utf8');

  // 检查是否已经包含了 scheduled
  if (!content.includes('async scheduled')) {
    const scheduledFunction = `
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    const baseUrl = "https://finance.380220.xyz"; // 需确保此域名对应的 Worker 能够接受外部请求
    const secret = env.CRON_SECRET || "";
    
    let targetUrls = [];
    
    // 精准路由分发
    if (cron === "*/10 * * * *") {
      // 仅运行哨兵巡检
      targetUrls = [\`\${baseUrl}/api/cron/health?token=\${secret}\`];
    } else if (cron === "0 13 * * 1-5") {
      // 每日任务：填充同步队列
      targetUrls = [\`\${baseUrl}/api/cron/daily?token=\${secret}\`];
    } else if (cron === "*/5 1-7 * * 1-5") {
      // 盘中任务：消化同步队列
      targetUrls = [\`\${baseUrl}/api/cron/sync?token=\${secret}\`];
    } else {
      // 兜底：触发汇总任务 (如 03:00 的归档等)
      targetUrls = [
        \`\${baseUrl}/api/cron/health?token=\${secret}\`,
        \`\${baseUrl}/api/cron/sync?token=\${secret}\`
      ];
    }

    console.log(\`[Trigger] Cron [\${cron}] triggered. Dispatching \${targetUrls.length} tasks.\`);
    
    const tasks = targetUrls.map(url => 
      fetch(url)
        .then(res => console.log(\`[Trigger] SUCCESS [\${res.status}]: \${url}\`))
        .catch(e => console.error("[Trigger] FAILED:", url, e.message))
    );
    
    ctx.waitUntil(Promise.allSettled(tasks));
  },`;


    // 查找到 export default {
    const searchStr = 'export default {';
    const index = content.indexOf(searchStr);
    if (index !== -1) {
      const insertionPoint = index + searchStr.length;
      content = content.slice(0, insertionPoint) + scheduledFunction + content.slice(insertionPoint);
      fs.writeFileSync(workerPath, content);
      console.log('Successfully patched .open-next/worker.js with scheduled() handler');
    } else {
      console.error('Could not find export default in .open-next/worker.js');
    }
  } else {
    console.log('scheduled() handler already exists in .open-next/worker.js');
  }
} else {
  console.error('.open-next/worker.js not found. Make sure to run build first.');
}
