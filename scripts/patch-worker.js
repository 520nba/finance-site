import fs from 'node:fs';
import path from 'node:path';

const workerPath = path.resolve('.open-next/worker.js');

if (fs.existsSync(workerPath)) {
    let content = fs.readFileSync(workerPath, 'utf8');

    // 检查是否已经包含了 scheduled
    if (!content.includes('async scheduled')) {
        const scheduledFunction = `
  async scheduled(event, env, ctx) {
    const url = "https://finance.380220.xyz/api/cron/sync?token=" + (env.CRON_SECRET || "");
    console.log("[Cron] Triggering sync via public URL:", url);
    try {
      const response = await fetch(url);
      console.log("[Cron] Public Sync status:", response.status);
    } catch (e) {
      console.error("[Cron] Failed to trigger sync:", e.message);
    }
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
