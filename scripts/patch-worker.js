import fs from 'node:fs';
import path from 'node:path';

const workerPath = path.resolve('.open-next/worker.js');

if (!fs.existsSync(workerPath)) {
  console.error('.open-next/worker.js not found. Make sure to run build first.');
  process.exit(1);
}

let content = fs.readFileSync(workerPath, 'utf8');

if (content.includes('async scheduled')) {
  console.log('scheduled() handler already exists in .open-next/worker.js');
  process.exit(0);
}

// ─── 1. 注入 scheduled() ────────────────────────────────────────────────────

const scheduledFunction = `
  async scheduled(event, env, ctx) {
    try {
      const rawCron = (event && typeof event.cron === 'string') ? event.cron : "";
      const normalizedCron = rawCron.replace(/\\s+/g, ' ').trim();
      const secret = env.CRON_SECRET || "";

      // 严格路由映射 (Strict Mapping)
      const routes = {
        "*/10 * * * *": [
          \`/api/cron/health?token=\${secret}\`,
          \`/api/cron/sync?token=\${secret}\`,
        ],
        "0 13 * * 1-5": [
          \`/api/cron/daily?token=\${secret}\`,
          \`/api/cron/sync?token=\${secret}\`,
        ],
        "0 19 * * 1-6": [
          \`/api/cron/daily?token=\${secret}\`, // 19:00 重新排队，捕获收盘数据
          \`/api/cron/sync?token=\${secret}\`,
        ],
        "*/5 1-7 * * 1-5": [
          \`/api/cron/sync?token=\${secret}\`,
        ],
      };

      // 优先级：rawCron -> normalizedCron -> 不允许静默回退，但为了鲁棒性，如果没匹配到则记录错误且中断
      const paths = routes[rawCron] ?? routes[normalizedCron];
      if (!paths) {
        // 如果是手动触发且没带 cron，为了兼容性可以考虑默认，但在严格模式下我们明确指出缺失
        console.error(\`[Trigger] No route configured for cron expression: "\${normalizedCron}". Aborting.\`);
        return;
      }

      console.log(\`[Trigger] Cron [\${normalizedCron}] dispatching \${paths.length} task(s) via workerExport.\`);

      // 用具名引用替代 this，避免 this 上下文丢失
      const tasks = paths.map(async (p) => {
        // 单任务超时保护：30s
        const timeoutMs = 30_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const req = new Request(\`http://internal\${p}\`, {
            headers: { 'x-internal-cron': 'true' },
            signal: controller.signal,
          });
          // 直接引用导出对象，规避 this 指向问题 (Direct Invocation)
          const res = await workerExport.fetch(req, env, ctx);
          const body = await res.text();
          console.log(\`[Trigger] SUCCESS [\${res.status}]: \${p} -> \${body.slice(0, 80)}\`);
        } catch (e) {
          if (e.name === 'AbortError') {
            console.error(\`[Trigger] TIMEOUT (>\${timeoutMs}ms): \${p}\`);
          } else {
            console.error(\`[Trigger] FAILED: \${p} -> \${e.message}\`);
          }
        } finally {
          clearTimeout(timer);
        }
      });

      await Promise.all(tasks);
    } catch (globalError) {
      console.error(\`[Trigger] Critical failure: \${globalError.message}\`);
    }
  },`;

// 匹配 `export default {` 并注入
const exportRegex = /export\s+default\s*\{/;
const exportMatch = content.match(exportRegex);

if (!exportMatch) {
  console.error('Could not find "export default {" in .open-next/worker.js — aborting patch.');
  process.exit(1);
}

const exportInsertAt = exportMatch.index + exportMatch[0].length;
content =
  content.slice(0, exportInsertAt) +
  scheduledFunction +
  content.slice(exportInsertAt);

// ─── 2. 把导出对象赋给具名变量（解决 this 问题）──────────────────────────────
//
// 将:   export default {
// 改为: const workerExport = {
//       ...
//       export default workerExport;
//
// 这样 scheduled / fetch 内部可以直接用 workerExport.fetch() 引用自身，
// 完全不依赖 this。

// 找到文件末尾的 `}` (导出对象的闭合括号) ── 用最后一个顶层 `}` 定位
const lastBrace = content.lastIndexOf('\n}');
if (lastBrace === -1) {
  console.error('Could not locate closing brace of export default object — aborting patch.');
  process.exit(1);
}

// 替换 export default { → const workerExport = {
content = content.replace(exportRegex, 'const workerExport = {');

// 在最后的 } 之后追加 export default workerExport;
content =
  content.slice(0, lastBrace + 2) +
  '\nexport default workerExport;\n' +
  content.slice(lastBrace + 2);

// ─── 3. 注入 debug 路由（/__manual_scheduled）────────────────────────────────

const fetchStartRegex = /async\s+fetch\s*\(\s*request\s*,\s*env\s*,\s*ctx\s*\)\s*\{/;
const fetchMatch = content.match(fetchStartRegex);

if (fetchMatch) {
  const debugRoute = `
    // ── Debug: 手动触发 scheduled ──────────────────────────────────────────
    {
      const _u = new URL(request.url);
      if (_u.pathname === '/__manual_scheduled') {
        if (!env.CRON_SECRET || _u.searchParams.get('token') !== env.CRON_SECRET) {
          console.warn('[Debug] Unauthorized /__manual_scheduled attempt');
          return new Response('Unauthorized', { status: 401 });
        }
        const cron = _u.searchParams.get('cron') || '*/10 * * * *';
        console.log(\`[Debug] Manually triggering scheduled handler, cron="\${cron}"\`);
        await workerExport.scheduled({ cron }, env, ctx);
        return new Response(
          JSON.stringify({ success: true, cron, message: 'Manual Scheduled Triggered' }, null, 2),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    // ── End Debug ──────────────────────────────────────────────────────────
`;
  const fetchInsertAt = fetchMatch.index + fetchMatch[0].length;
  content =
    content.slice(0, fetchInsertAt) +
    debugRoute +
    content.slice(fetchInsertAt);
} else {
  // 非致命：仅警告，不中止
  console.warn('[patch] Could not locate fetch() handler — debug route NOT injected.');
}

// ─── 4. 写回文件 ─────────────────────────────────────────────────────────────

fs.writeFileSync(workerPath, content, 'utf8');
console.log('✅ Successfully patched .open-next/worker.js');
console.log('   • scheduled() handler injected');
console.log('   • export renamed to workerExport (fixes this-context bug)');
console.log('   • /__manual_scheduled debug route injected');
