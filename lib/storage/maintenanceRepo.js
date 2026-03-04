import { getKvStorage, readDoc, memoryCache } from './kvClient';
import { addSystemLog } from './logRepo';
import { deleteNameFromKV, NAMES_KEY } from './nameRepo';

export async function cleanupOldData() {
    // Legacy support
}

export async function cleanupSingleAssetIfNotUsed(type, code) {
    const kv = await getKvStorage();
    if (!kv) return false;

    try {
        // ⚡ 宽限期延迟：等待 3 秒再执行清理
        // 原因：当用户 A 删除资产的同时，用户 B 可能正在添加同一资产但 POST 尚未到达。
        // 3 秒足以让绝大多数在途的 POST 请求完成写入，大幅降低误删概率。
        await new Promise(r => setTimeout(r, 3000));

        const INDEX_KEY = 'users_index';
        const userIds = await readDoc(INDEX_KEY, []);
        let isUsed = false;

        // 重新读取所有用户资产（宽限期后的最终状态）
        await Promise.all(userIds.map(async (uid) => {
            const list = await readDoc(`user:assets:${uid}`, []);
            if (list.some(a => a.type === type && a.code.toLowerCase() === code.toLowerCase())) {
                isUsed = true;
            }
        }));

        if (!isUsed) {
            // 各步骤独立 try/catch，防止一步失败中断整个清理流程
            try {
                await kv.delete(`hist:${type}:${code}`);
            } catch (e) {
                console.warn(`[Cleanup] Failed to delete hist for ${type}:${code}:`, e?.message);
            }

            try {
                await deleteNameFromKV(type, code);
            } catch (e) {
                console.warn(`[Cleanup] Failed to delete name for ${type}:${code}:`, e?.message);
            }

            // 分时数据可能跨多个 Key，分页删除
            try {
                let cursor = undefined;
                while (true) {
                    const list = await kv.list({ prefix: `intra:${code}:`, cursor, limit: 100 });
                    for (const keyObj of list.keys) {
                        await kv.delete(keyObj.name);
                    }
                    if (list.list_complete) break;
                    cursor = list.cursor;
                }
            } catch (e) {
                console.warn(`[Cleanup] Failed to delete intraday for ${code}:`, e?.message);
            }

            await addSystemLog('INFO', 'Assets', `Auto-purged cached data for abandoned asset: ${type} ${code}`);
            return true;
        }
    } catch (e) {
        console.error('[Auto Purge] Error:', e);
    }
    return false;
}

export async function purgeZombieAssets() {
    const kv = await getKvStorage();
    if (!kv) return { success: false, reason: 'KV Storage API unavailable' };

    try {
        const INDEX_KEY = 'users_index';
        const userIds = await readDoc(INDEX_KEY, []);
        const activeAssets = new Set();

        await Promise.all(userIds.map(async (uid) => {
            const list = await readDoc(`user:assets:${uid}`, []);
            list.forEach(a => {
                if (a.type && a.code) activeAssets.add(`${a.type}:${a.code.toLowerCase()}`);
            });
        }));

        const results = {
            deleted_hist: 0,
            deleted_names: 0,
            deleted_quotes: 0,
            deleted_intra: 0
        };

        let cursor = undefined;
        while (true) {
            const list = await kv.list({ prefix: 'hist:', cursor, limit: 1000 });
            for (const keyObj of list.keys) {
                const parts = keyObj.name.split(':');
                if (parts.length >= 3) {
                    const typeCode = `${parts[1]}:${parts[2].toLowerCase()}`;
                    if (!activeAssets.has(typeCode)) {
                        await kv.delete(keyObj.name);
                        results.deleted_hist++;
                    }
                }
            }
            if (list.list_complete) break;
            cursor = list.cursor;
        }

        try {
            const namesRaw = await kv.get(NAMES_KEY);
            if (namesRaw) {
                const namesMap = JSON.parse(namesRaw);
                const cleanedNames = {};
                let deletedCount = 0;
                for (const [k, v] of Object.entries(namesMap)) {
                    if (activeAssets.has(k.toLowerCase())) {
                        cleanedNames[k] = v;
                    } else {
                        deletedCount++;
                    }
                }
                if (deletedCount > 0) {
                    await kv.put(NAMES_KEY, JSON.stringify(cleanedNames));
                    memoryCache.delete(NAMES_KEY);
                    results.deleted_names = deletedCount;
                }
            }
        } catch (e) {
            console.error('[Purge] Names cleanup error:', e.message);
        }

        cursor = undefined;
        while (true) {
            const list = await kv.list({ prefix: 'quote:', cursor, limit: 1000 });
            for (const keyObj of list.keys) {
                const code = keyObj.name.split(':')[1];
                if (code) {
                    if (!activeAssets.has(`stock:${code.toLowerCase()}`) && !activeAssets.has(`fund:${code.toLowerCase()}`)) {
                        await kv.delete(keyObj.name);
                        results.deleted_quotes++;
                    }
                }
            }
            if (list.list_complete) break;
            cursor = list.cursor;
        }

        cursor = undefined;
        while (true) {
            const list = await kv.list({ prefix: 'intra:', cursor, limit: 1000 });
            for (const keyObj of list.keys) {
                const code = keyObj.name.split(':')[1];
                if (code) {
                    if (!activeAssets.has(`stock:${code.toLowerCase()}`) && !activeAssets.has(`fund:${code.toLowerCase()}`)) {
                        await kv.delete(keyObj.name);
                        results.deleted_intra++;
                    }
                }
            }
            if (list.list_complete) break;
            cursor = list.cursor;
        }

        await addSystemLog('WARN', 'Cleanup', `Purged zombie assets: ${results.deleted_hist} hist, ${results.deleted_names} names`);
        return { success: true, ...results };
    } catch (e) {
        console.error('[Purge] Cleanup error:', e);
        return { success: false, error: e.message };
    }
}
