/**
 * 统一存储接口
 * 支持本地文件系统 (Local FS) 与 Cloudflare KV
 */

// 探测是否在 Cloudflare Pages (Edge) 环境
const IS_CF = process.env.NEXT_RUNTIME === 'edge' || (typeof process !== 'undefined' && process.env.STOCK_KV !== undefined);

export async function readDoc(key, defaultValue = {}) {
    if (IS_CF) {
        try {
            const data = await process.env.STOCK_KV.get(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) {
            console.error(`[Storage] KV read failed for ${key}:`, e.message);
            return defaultValue;
        }
    } else {
        // 本地环境：动态导入 Node 模块
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'data', `${key.replace(/:/g, '_')}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return defaultValue;
        }
    }
}

export async function writeDoc(key, data) {
    const val = JSON.stringify(data, null, 2);
    if (IS_CF) {
        try {
            await process.env.STOCK_KV.put(key, val);
            return true;
        } catch (e) {
            console.error(`[Storage] KV write failed for ${key}:`, e.message);
            return false;
        }
    } else {
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'data', `${key.replace(/:/g, '_')}.json`);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, val);
            return true;
        } catch (e) {
            console.error(`[Storage] FS write failed for ${key}:`, e.message);
            return false;
        }
    }
}

export async function listKeys(prefix) {
    if (IS_CF) {
        try {
            const list = await process.env.STOCK_KV.list({ prefix });
            return list.keys.map(k => k.name);
        } catch (e) {
            return [];
        }
    } else {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const files = await fs.readdir(path.join(process.cwd(), 'data'));
            return files
                .filter(f => f.startsWith(prefix.replace(/:/g, '_')))
                .map(f => f.replace(/_/g, ':').replace('.json', ''));
        } catch {
            return [];
        }
    }
}
