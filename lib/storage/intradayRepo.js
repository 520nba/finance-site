import { queryOne, queryAll, runSql, getD1Storage, getRequiredDb } from './d1Client';
import { memoryCache } from './memoryCache';
import { chunkArray, getBeijingDate } from '../utils';
import { isMarketClosed } from '../constants/tradingHours';

/**
 * 从 D1 或内存获取分时数据
 */
export async function getIntraday(code, date, fallbackToLatest = false, env = null) {
    const memKey = `intra:${code}:${date}`;
    const cached = memoryCache.get(memKey);
    if (cached) return cached;

    try {
        let row = await queryOne('SELECT data FROM asset_intraday WHERE code = ? AND record_date = ?', [code, date], env);

        if (!row && fallbackToLatest) {
            // 尝试获取最近 3 天的数据作为兜底
            row = await queryOne(
                'SELECT data FROM asset_intraday WHERE code = ? AND record_date < ? ORDER BY record_date DESC LIMIT 1',
                [code, date],
                env
            );
        }

        if (row && row.data) {
            const data = JSON.parse(row.data);
            return data;
        }
    } catch (e) {
        console.error(`[IntradayRepo] getIntraday failed for ${code}:`, e.message);
    }
    return null;
}

/**
 * 保存分时数据到 D1
 */
export async function saveIntraday(code, date, data, forcePersist = false, env = null) {
    const memKey = `intra:${code}:${date}`;

    try {
        // 使用统一的交易时段常量判断是否已收盘
        const bjNow = getBeijingDate();
        const marketClosed = isMarketClosed(bjNow);

        if (marketClosed || forcePersist) {
            await runSql(
                'INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [code, date, JSON.stringify(data)],
                env
            );
            memoryCache.delete(memKey);
        } else {
            memoryCache.set(memKey, data);
        }
    } catch (e) {
        console.error(`[IntradayRepo] saveIntraday failed for ${code}:`, e.message);
    }
}

/**
 * 批量获取分时数据
 */
export async function getBulkIntraday(items, date, env = null) {
    if (!items || items.length === 0) return {};

    const result = {};
    const toQuery = [];

    for (const it of items) {
        const cached = memoryCache.get(`intra:${it.code}:${date}`);
        if (cached) {
            result[it.code] = cached;
        } else {
            toQuery.push(it.code);
        }
    }

    if (toQuery.length > 0) {
        const groups = chunkArray(toQuery, 30);
        for (const codes of groups) {
            try {
                const placeholders = codes.map(() => '?').join(',');
                const sql = `SELECT code, data, record_date, updated_at FROM asset_intraday WHERE record_date = ? AND code IN (${placeholders})`;
                const rows = await queryAll(sql, [date, ...codes], env);
                for (const row of rows) {
                    const parsed = JSON.parse(row.data);
                    // 注入 DB 元数据，供 isDbDataFresh 进行新鲜度判定
                    result[row.code] = {
                        ...parsed,
                        record_date: row.record_date,
                        updated_at: row.updated_at
                    };
                }
            } catch (e) {
                console.error('[IntradayRepo] getBulkIntraday group failed:', e.message);
            }
        }
    }

    return result;
}

/**
 * 批量保存分时数据到 D1
 */
export async function saveIntradayBatch(records, env = null) {
    if (!records || records.length === 0) return;
    const db = await getRequiredDb(env);

    try {
        const statements = records.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
                .bind(r.code, r.date, JSON.stringify(r.data))
        );

        const CHUNK = 50;
        for (let i = 0; i < statements.length; i += CHUNK) {
            await db.batch(statements.slice(i, i + CHUNK));
        }

        for (const r of records) {
            memoryCache.set(`intra:${r.code}:${r.date}`, r.data);
        }
    } catch (e) {
        console.error(`[IntradayRepo] saveIntradayBatch failed:`, e.message);
    }
}

/**
 * 原子化更新分时数据 JSON (Cron 专用)
 * 职责：读取现有 JSON，将新点位追加/覆盖，再写回。
 * 解决了 Cron 写 Points 表而前端读 Intraday 表的断层问题。
 */
export async function updateIntradayJson(records, env = null) {
    if (!records || records.length === 0) return;
    const db = await getRequiredDb(env);
    const today = records[0].date;

    try {
        // 1. 批量读取当前库中的数据
        const codes = records.map(r => r.code);
        const currentDataMap = await getBulkIntraday(records.map(r => ({ code: r.code })), today, env);

        // 2. 准备更新语句
        const statements = records.map(r => {
            const current = currentDataMap[r.code] || { code: r.code, points: [], prevClose: 0 };

            // 合并逻辑 (Map 查找 O(N+M)，替代 findIndex O(N×M))
            const pointMap = new Map();
            for (const p of current.points) {
                pointMap.set(p.time, p);
            }
            for (const newP of r.points) {
                pointMap.set(newP.time, newP);
            }

            // 保持时间有序，Map 插入顺序不保证正确排序
            const newPoints = Array.from(pointMap.values())
                .sort((a, b) => a.time.localeCompare(b.time));

            const updatedData = {
                ...current,
                points: newPoints,
                price: r.price || current.price,
                prevClose: r.prevClose || current.prevClose
            };

            return db.prepare('INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
                .bind(r.code, today, JSON.stringify(updatedData));
        });

        const CHUNK = 50;
        for (let i = 0; i < statements.length; i += CHUNK) {
            await db.batch(statements.slice(i, i + CHUNK));
        }

        // 清理缓存
        for (const r of records) {
            memoryCache.delete(`intra:${r.code}:${today}`);
        }
    } catch (e) {
        console.error(`[IntradayRepo] updateIntradayJson failed:`, e.message);
    }
}

