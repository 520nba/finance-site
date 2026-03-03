import { getCloudflareContext } from "@opennextjs/cloudflare";

// 内存缓存 fallback (仅限本地开发且无 KV 绑定时)
const memoryCache = new Map();

async function getKvStorage() {
    try {
        const ctx = await getCloudflareContext();
        if (ctx?.env?.STOCK_DATA) return ctx.env.STOCK_DATA;
    } catch (e) {
        // console.log('[Storage] getCloudflareContext error:', e.message);
    }

    return null;
}

// ── 基础文档操作 (配置、用户资产等) ───────────────────

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
    if (kv) {
        // 设置 7 天 TTL (过期自动清理)
        await kv.put(key, JSON.stringify(data), { expirationTtl: 7 * 24 * 3600 });
    } else {
        memoryCache.set(key, data);
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
    const promises = Object.entries(namesMap).map(([key, name]) => {
        const [type, code] = key.split(':');
        if (kv) return kv.put(`name:${type}:${code}`, name);
        memoryCache.set(`name:${type}:${code}`, name);
    });
    await Promise.all(promises);
}

// ── 实时报价 (quote:{code}) ──────────────────────────

export async function saveQuotesToKV(quotesMap) {
    const kv = await getKvStorage();
    const timeStr = new Date().toISOString();
    const promises = Object.entries(quotesMap).map(([code, q]) => {
        const val = { ...q, updated_at: timeStr };
        if (kv) return kv.put(`quote:${code}`, JSON.stringify(val), { expirationTtl: 3600 }); // 60分钟失效
        memoryCache.set(`quote:${code}`, val);
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

export async function deleteAssetData(code) {
    // 彻底从 KV 中删除该资产的分时、报价、名称引用 (历史可保留也可删)
    // 这里的业务逻辑倾向于不删除历史，若要删，需匹配 type
    const kv = await getKvStorage();
    if (kv) {
        await Promise.all([
            kv.delete(`quote:${code}`),
            // 注意：KV 无法通过通配符删除 code 对应的所有日期分时，需结合业务逻辑或约定
        ]);
    }
}
