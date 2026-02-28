/**
 * 极致安全的存储抽象层 (针对 Cloudflare Edge 深度优化)
 */

const IS_EDGE = process.env.NEXT_RUNTIME === 'edge';

// 最简单的绑定获取方式，避免任何可能导致 Worker 崩溃的复杂逻辑
function getKvStorage() {
    if (typeof STOCK_KV !== 'undefined') return STOCK_KV;
    if (typeof globalThis !== 'undefined' && globalThis.STOCK_KV) return globalThis.STOCK_KV;
    return null;
}

export async function readDoc(key, defaultValue = {}) {
    if (IS_EDGE) {
        try {
            const kv = getKvStorage();
            if (kv) {
                const data = await kv.get(key);
                return data ? JSON.parse(data) : defaultValue;
            }
        } catch (e) { }
        return defaultValue;
    }

    // 本地开发
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'data', `${key.replace(/:/g, '_')}.json`);
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
            const kv = getKvStorage();
            if (kv) {
                await kv.put(key, dataStr);
                return true;
            }
        } catch (e) { }
        return false;
    }

    // 本地开发
    try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const dataDir = path.join(process.cwd(), 'data');
        const filePath = path.join(dataDir, `${key.replace(/:/g, '_')}.json`);
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(filePath, dataStr);
        return true;
    } catch (e) {
        return false;
    }
}

export async function listDocs(prefix = '') {
    if (IS_EDGE) {
        try {
            const kv = getKvStorage();
            if (kv) {
                const result = await kv.list({ prefix });
                return result.keys.map(k => k.name);
            }
        } catch (e) { }
        return [];
    }

    // 本地开发
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
