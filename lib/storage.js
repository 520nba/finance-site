// 零依赖环境探测，避免导入失败
export async function getKvStorage() {
    // 方案 1: 尝试从全局 ctx 获取 (OpenNext 注入方式)
    try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        const ctx = await getCloudflareContext();
        if (ctx?.env?.STOCK_DATA) return ctx.env.STOCK_DATA;
    } catch (e) { }

    // 方案 2: 直接尝试全局 process.env (兼容某些构建环境)
    try {
        if (typeof process !== 'undefined' && process.env?.STOCK_DATA) {
            return process.env.STOCK_DATA;
        }
    } catch (e) { }

    return null;
}

// ── 基础文档操作 (配置、用户资产等) ───────────────────

const memoryCache = new Map();

export async function readDoc(key, defaultValue = {}) {
    const kv = await getKvStorage();
    if (kv) {
        try {
            const data = await kv.get(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) { }
    }
    const cached = memoryCache.get(key);
    return cached !== undefined ? cached : defaultValue;
}

export async function writeDoc(key, val) {
    const kv = await getKvStorage();
    const dataStr = typeof val === 'string' ? val : JSON.stringify(val);
    if (kv) {
        try {
            await kv.put(key, dataStr);
            return true;
        } catch (e) { }
    }
    memoryCache.set(key, val);
    return true;
}

export async function deleteDoc(key) {
    const kv = await getKvStorage();
    if (kv) {
        try {
            await kv.delete(key);
            return true;
        } catch (e) { }
    }
    memoryCache.delete(key);
    return true;
}

// ── 资产历史数据 (hist:{type}:{code}) ────────────────

export async function getHistoryFromKV(code, type, days = 250) {
    const key = `hist:${type}:${code}`;
    const doc = await readDoc(key, []);
    const history = Array.isArray(doc) ? doc : (doc?.history || []);
    // 返回最近的 days 条，并确保按日期升序 (KV 存储建议直接存有序数组)
    return history.slice(-days);
}

export async function getBulkHistoryFromKV(items, days = 250) {
    const result = {};
    const promises = items.map(async (it) => {
        const key = `hist:${it.type}:${it.code}`;
        const doc = await readDoc(key, null);
        const history = Array.isArray(doc) ? doc : (doc?.history || []);
        if (history && history.length > 0) {
            result[`${it.type}:${it.code}`] = history.slice(-days);
        }
    });

    await Promise.all(promises);
    return result;
}

export async function insertDailyPrice(code, type, price, date) {
    const key = `hist:${type}:${code}`;
    const doc = await readDoc(key, []);
    const history = Array.isArray(doc) ? doc : (doc?.history || []);

    // 简单去重，如果日期已存在则更新，否则推入
    const existingIdx = history.findIndex(p => p.date === date);
    if (existingIdx > -1) {
        history[existingIdx].value = price;
    } else {
        history.push({ date, value: price });
        // 保持有序 (日期格式为 YYYY-MM-DD，直接 sort 字符串即可)
        history.sort((a, b) => a.date.localeCompare(b.date));
    }

    // 历史保留 400 条
    if (history.length > 400) history.shift();
    await writeDoc(key, { date: date, history });
}

export async function insertDailyPricesBatch(records) {
    // 按代码分组处理，减少重复读写频率
    const groups = {};
    for (const r of records) {
        const key = `${r.type}:${r.code}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    }

    const promises = Object.entries(groups).map(async ([key, items]) => {
        const [type, code] = key.split(':');
        const kvKey = `hist:${type}:${code}`;
        const doc = await readDoc(kvKey, []);
        const history = Array.isArray(doc) ? doc : (doc?.history || []);
        let latestDate = history.length > 0 ? history[history.length - 1].date : '';

        items.forEach(it => {
            const idx = history.findIndex(p => p.date === it.date);
            if (idx > -1) history[idx].value = it.price;
            else history.push({ date: it.date, value: it.price });
            if (it.date > latestDate) latestDate = it.date;
        });

        history.sort((a, b) => a.date.localeCompare(b.date));
        if (history.length > 400) history.splice(0, history.length - 400);
        await writeDoc(kvKey, { date: latestDate, history });
    });

    await Promise.all(promises);
}

// ── 资产分时数据 (intra:{code}:{date}) ───────────────

export async function getIntradayFromKV(code, date, fallbackToLatest = false) {
    const key = `intra:${code}:${date}`;
    let data = await readDoc(key, null);

    if (!data && fallbackToLatest) {
        const kv = await getKvStorage();
        if (kv) {
            // KV 不支持简单排序获取最新，此处依赖 caller 明确传入 date 或使用约定前缀
            // 这里我们假定 fallback 时查找最近 3 天
            for (let i = 1; i <= 3; i++) {
                const prevDate = new Date(new Date(date).getTime() - i * 86400000).toISOString().split('T')[0];
                data = await readDoc(`intra:${code}:${prevDate}`, null);
                if (data) break;
            }
        }
    }
    return data;
}

export async function saveIntradayToKV(code, date, data) {
    const key = `intra:${code}:${date}`;
    const kv = await getKvStorage();
    try {
        if (kv) {
            // 设置 7 天 TTL (过期自动清理)
            await kv.put(key, JSON.stringify(data), { expirationTtl: 7 * 24 * 3600 });
        } else {
            memoryCache.set(key, data);
        }
    } catch (e) {
        console.error(`[Storage] Failed to save intraday for ${code}:`, e.message);
    }
}

export async function getBulkIntradayFromKV(items, date) {
    const kv = await getKvStorage();
    const result = {};
    const promises = items.map(async (it) => {
        const key = `intra:${it.code}:${date}`;
        if (kv) {
            const data = await kv.get(key);
            if (data) result[it.code] = JSON.parse(data);
        } else {
            const data = memoryCache.get(key);
            if (data) result[it.code] = data;
        }
    });

    await Promise.all(promises);
    return result;
}

// ── 资产名称 (name:{type}:{code}) ────────────────────

export async function getAssetNamesFromKV(items) {
    const kv = await getKvStorage();
    const result = {};

    const promises = items.map(async (it) => {
        const key = `name:${it.type}:${it.code}`;
        let name;
        if (kv) {
            name = await kv.get(key);
        } else {
            name = memoryCache.get(key);
        }
        if (name) result[`${it.type}:${it.code}`] = name;
    });

    await Promise.all(promises);
    return result;
}

export async function saveAssetNamesToKV(namesMap) {
    const kv = await getKvStorage();
    const promises = Object.entries(namesMap).map(async ([key, name]) => {
        const [type, code] = key.split(':');
        try {
            if (kv) await kv.put(`name:${type}:${code}`, name);
            else memoryCache.set(`name:${type}:${code}`, name);
        } catch (e) {
            console.error(`[Storage] Failed to save name for ${key}:`, e.message);
        }
    });
    await Promise.all(promises);
}

// ── 实时报价 (quote:{code}) ──────────────────────────

export async function saveQuotesToKV(quotesMap) {
    const kv = await getKvStorage();
    const timeStr = new Date().toISOString();
    const promises = Object.entries(quotesMap).map(async ([code, q]) => {
        const val = { ...q, updated_at: timeStr };
        try {
            if (kv) await kv.put(`quote:${code}`, JSON.stringify(val), { expirationTtl: 3600 }); // 60分钟失效
            else memoryCache.set(`quote:${code}`, val);
        } catch (e) {
            console.error(`[Storage] Failed to save quote for ${code}:`, e.message);
        }
    });
    await Promise.all(promises);
}

export async function getBulkQuotesFromKV(codes) {
    const kv = await getKvStorage();
    const result = {};

    const promises = codes.map(async (code) => {
        const key = `quote:${code}`;
        if (kv) {
            const data = await kv.get(key);
            if (data) result[code] = JSON.parse(data);
        } else {
            const data = memoryCache.get(key);
            if (data) result[code] = data;
        }
    });

    await Promise.all(promises);
    return result;
}

// ── 系统日志 (logs:system - 滚动列表) ─────────────────

export async function addSystemLog(level, module, message) {
    const key = 'logs:system';
    console.log(`[LOG][${level}][${module}] ${message}`);

    try {
        const logs = await readDoc(key, []);
        logs.unshift({
            level,
            module,
            message,
            timestamp: new Date().toISOString()
        });
        // 只保留最近 200 条
        if (logs.length > 200) logs.pop();
        await writeDoc(key, logs);
    } catch (e) { }
}

export async function getSystemLogs(hours = 48) {
    const logs = await readDoc('logs:system', []);
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    return logs.filter(l => l.timestamp > cutoff);
}

// ── 维护操作 ──────────────────────────────────────────

export async function cleanupOldData() {
    // KV 版本的清理主要通过 ExpirationTTL 自动完成 (intraday, quotes)。
    // 历史数据在写入时已通过 slice() 截断。
    // 手动调用仅作为兼容保留。
}

export async function cleanupSingleAssetIfNotUsed(type, code) {
    const kv = await getKvStorage();
    if (!kv) return false;

    try {
        const INDEX_KEY = 'users_index';
        const userIds = await readDoc(INDEX_KEY, []);
        let isUsed = false;

        await Promise.all(userIds.map(async (uid) => {
            const list = await readDoc(`user:assets:${uid}`, []);
            if (list.some(a => a.type === type && a.code.toLowerCase() === code.toLowerCase())) {
                isUsed = true;
            }
        }));

        if (!isUsed) {
            await kv.delete(`hist:${type}:${code}`);
            await kv.delete(`name:${type}:${code}`);
            await kv.delete(`quote:${code}`);

            // Delete intra keys matching this code
            let cursor = undefined;
            while (true) {
                const list = await kv.list({ prefix: `intra:${code}:`, cursor, limit: 100 });
                for (const keyObj of list.keys) {
                    await kv.delete(keyObj.name);
                }
                if (list.list_complete) break;
                cursor = list.cursor;
            }

            await addSystemLog('INFO', 'Assets', `Auto-purged cached data for abandoned asset: ${type} ${code}`);
            return true;
        }
    } catch (e) {
        console.error('[Auto Purge] Error:', e);
    }
    return false;
}

/**
 * 核心大扫除：清理掉没有任何用户关注的“僵尸”行情数据
 * 这不仅减小 KV 占用，更重要的是避免 Cron 定时任务去同步这些没人看的数据。
 */
export async function purgeZombieAssets() {
    const kv = await getKvStorage();
    if (!kv) return { success: false, reason: 'KV Storage API unavailable' };

    try {
        // 1. 获取所有用户
        const INDEX_KEY = 'users_index';
        const userIds = await readDoc(INDEX_KEY, []);
        const activeAssets = new Set();

        // 2. 并发读取所有用户的资产，存入 Set (格式: type:code)
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

        // 3. 扫描并清理历史数据 (hist:*)
        let cursor = undefined;
        while (true) {
            const list = await kv.list({ prefix: 'hist:', cursor, limit: 1000 });
            for (const keyObj of list.keys) {
                // key 格式: hist:stock:sh600000
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

        // 4. 扫描并清理名称数据 (name:*)
        cursor = undefined;
        while (true) {
            const list = await kv.list({ prefix: 'name:', cursor, limit: 1000 });
            for (const keyObj of list.keys) {
                const parts = keyObj.name.split(':');
                if (parts.length >= 3) {
                    const typeCode = `${parts[1]}:${parts[2].toLowerCase()}`;
                    if (!activeAssets.has(typeCode)) {
                        await kv.delete(keyObj.name);
                        results.deleted_names++;
                    }
                }
            }
            if (list.list_complete) break;
            cursor = list.cursor;
        }

        // 5. 扫描并清理实时报价 (quote:*)
        cursor = undefined;
        while (true) {
            const list = await kv.list({ prefix: 'quote:', cursor, limit: 1000 });
            for (const keyObj of list.keys) {
                const code = keyObj.name.split(':')[1];
                if (code) {
                    // 报价只有代码，需要同时检查股票和基金合集
                    if (!activeAssets.has(`stock:${code.toLowerCase()}`) && !activeAssets.has(`fund:${code.toLowerCase()}`)) {
                        await kv.delete(keyObj.name);
                        results.deleted_quotes++;
                    }
                }
            }
            if (list.list_complete) break;
            cursor = list.cursor;
        }

        // 6. 扫描并清理分时数据 (intra:*)
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
