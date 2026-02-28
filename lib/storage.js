/**
 * 统一存储抽象接口 (生产环境对接 Cloudflare KV，开发环境对接本地文件系统)
 * 警告：边缘运行时 (Edge Runtime) 严禁引用 fs/path 等 Node.js 模块。
 */

const IS_EDGE = process.env.NEXT_RUNTIME === 'edge';

// 动态获取 KV 绑定的安全助手
async function getKvStorage() {
    if (!IS_EDGE) return null;

    // 尝试多种方式获取 STOCK_KV 绑定
    // 1. 通过 @cloudflare/next-on-pages 的 getRequestContext (官方推荐)
    try {
        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const ctx = getRequestContext();
        if (ctx?.env?.STOCK_KV) return ctx.env.STOCK_KV;
    } catch (e) { }

    // 2. 尝试全局变量 (某些环境或 Worker 模拟器)
    if (typeof globalThis !== 'undefined' && globalThis.STOCK_KV) return globalThis.STOCK_KV;

    // 3. Fallback 到 process.env (适配某些旧版或者转换层)
    if (typeof process !== 'undefined' && process.env.STOCK_KV) return process.env.STOCK_KV;

    return null;
}

export async function readDoc(key, defaultValue = {}) {
    if (IS_EDGE) {
        try {
            const kv = await getKvStorage();
            if (kv) {
                const data = await kv.get(key);
                return data ? JSON.parse(data) : defaultValue;
            }
        } catch (e) {
            console.error(`[Storage] KV Read Error for ${key}:`, e.message);
        }
        return defaultValue;
    }

    // --- 本地开发环境逻辑 (仅在 Node 运行时执行) ---
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const dataDir = path.join(process.cwd(), 'data');
        const filePath = path.join(dataDir, `${key.replace(/:/g, '_')}.json`);

        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return defaultValue;
    }
}

export async function writeDoc(key, val) {
    const dataStr = typeof val === 'string' ? val : JSON.stringify(val);

    if (IS_EDGE) {
        try {
            const kv = await getKvStorage();
            if (kv) {
                await kv.put(key, dataStr);
                return true;
            }
        } catch (e) {
            console.error(`[Storage] KV Write Error for ${key}:`, e.message);
        }
        return false;
    }

    // --- 本地开发环境逻辑 (仅在 Node 运行时执行) ---
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const dataDir = path.join(process.cwd(), 'data');
        const filePath = path.join(dataDir, `${key.replace(/:/g, '_')}.json`);

        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(filePath, dataStr);
        return true;
    } catch (e) {
        console.error(`[Storage] Local Write Error for ${key}:`, e.message);
        return false;
    }
}

export async function listDocs(prefix = '') {
    if (IS_EDGE) {
        try {
            const kv = await getKvStorage();
            if (kv) {
                const result = await kv.list({ prefix });
                return result.keys.map(k => k.name);
            }
        } catch (e) {
            console.error(`[Storage] KV List Error:`, e.message);
        }
        return [];
    }

    // --- 本地开发环境逻辑 ---
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const dataDir = path.join(process.cwd(), 'data');

        const files = await fs.readdir(dataDir);
        const filePrefix = prefix.replace(/:/g, '_');
        return files
            .filter(f => f.startsWith(filePrefix))
            .map(f => f.replace(/_/g, ':').replace('.json', ''));
    } catch (e) {
        return [];
    }
}
