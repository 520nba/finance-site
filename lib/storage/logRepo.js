import { readDoc, writeDoc } from './kvClient';

// 模块级节流时间戳（单位：ms）
// 注意：在 Cloudflare Workers 中，每个请求的 V8 Isolate 是独立的，
// 此变量只能在单请求生命周期内防止同一请求内的多次并发写入。
// 跨请求级别的日志竞态由 try/catch 静默吸收。
let _lastLogWriteMs = 0;

export async function addSystemLog(level, module, message) {
    const key = 'logs:system';
    // 总是输出到 console（无论是否写 KV）
    console.log(`[LOG][${level}][${module}] ${message}`);

    // 节流保护：同一请求/进程内 100ms 内只执行一次 KV 写入
    const now = Date.now();
    if (now - _lastLogWriteMs < 100) return;
    _lastLogWriteMs = now;

    try {
        const logs = await readDoc(key, []);
        logs.unshift({
            level,
            module,
            message,
            timestamp: new Date().toISOString()
        });
        if (logs.length > 200) logs.pop();
        await writeDoc(key, logs);
    } catch (e) { /* 日志丢失是并发竞态下可接受的权衡，不向上抛出 */ }
}


export async function getSystemLogs(hours = 48) {
    const logs = await readDoc('logs:system', []);
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    return logs.filter(l => l.timestamp > cutoff);
}
