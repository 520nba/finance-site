import { queryOne, queryAll, runSql, getD1Storage } from './d1Client';
import { memoryCache } from './memoryCache';
import { chunkArray } from '../utils';

/**
 * 从 D1 或内存获取分时数据
 */
export async function getIntraday(code, date, fallbackToLatest = false) {
    const memKey = `intra:${code}:${date}`;
    const cached = memoryCache.get(memKey);
    if (cached) return cached;

    try {
        let row = await queryOne('SELECT data FROM asset_intraday WHERE code = ? AND record_date = ?', [code, date]);

        if (!row && fallbackToLatest) {
            // 尝试获取最近 3 天的数据作为兜底
            row = await queryOne(
                'SELECT data FROM asset_intraday WHERE code = ? AND record_date < ? ORDER BY record_date DESC LIMIT 1',
                [code, date]
            );
        }

        if (row && row.data) {
            const data = JSON.parse(row.data);
            // 这里不回填内存缓存，因为分时数据通常较大，且只在交易时段有用
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
export async function saveIntraday(code, date, data, forcePersist = false) {
    const memKey = `intra:${code}:${date}`;

    try {
        const bjTime = new Date(Date.now() + (8 * 3600 * 1000));
        const timeValue = bjTime.getUTCHours() * 100 + bjTime.getUTCMinutes();
        const isMarketClosed = timeValue >= 1515 || timeValue < 900;

        // 如果是收盘后，或是强制持久化模式（比如定时的 Cron），持久化到 D1
        if (isMarketClosed || forcePersist) {
            await runSql(
                'INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [code, date, JSON.stringify(data)]
            );
            memoryCache.delete(memKey); // 持久化后清除内存
        } else {
            // 交易时段仅存于内存（高频更新）
            memoryCache.set(memKey, data);
        }
    } catch (e) {
        console.error(`[IntradayRepo] saveIntraday failed for ${code}:`, e.message);
    }
}

/**
 * 批量获取分时数据 (分批查询模式)
 */
export async function getBulkIntraday(items, date) {
    if (!items || items.length === 0) return {};

    const result = {};
    const toQuery = [];

    // 1. 内存缓存检查
    for (const it of items) {
        const cached = memoryCache.get(`intra:${it.code}:${date}`);
        if (cached) {
            result[it.code] = cached;
        } else {
            toQuery.push(it.code);
        }
    }

    if (toQuery.length > 0) {
        // 2. 分批查询 (每 30 个代码一块)
        const groups = chunkArray(toQuery, 30);
        for (const codes of groups) {
            try {
                const placeholders = codes.map(() => '?').join(',');
                const sql = `SELECT code, data FROM asset_intraday WHERE record_date = ? AND code IN (${placeholders})`;
                const rows = await queryAll(sql, [date, ...codes]);
                for (const row of rows) {
                    result[row.code] = JSON.parse(row.data);
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
export async function saveIntradayBatch(records) {
    if (!records || records.length === 0) return;
    const db = await getD1Storage();
    if (!db) return;

    try {
        const statements = records.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_intraday (code, record_date, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
                .bind(r.code, r.date, JSON.stringify(r.data))
        );

        const CHUNK = 50;
        for (let i = 0; i < statements.length; i += CHUNK) {
            await db.batch(statements.slice(i, i + CHUNK));
        }

        // 更新内存缓存
        for (const r of records) {
            memoryCache.set(`intra:${r.code}:${r.date}`, r.data);
        }
    } catch (e) {
        console.error(`[IntradayRepo] saveIntradayBatch failed:`, e.message);
    }
}

/**
 * 拼装巨型 SQL 批量插入分时点 (Cron 专用)
 */
export async function saveIntradayPointsBulk(points) {
    if (!points || points.length === 0) return;
    const db = await getD1Storage();
    if (!db) return;

    try {
        // 分片以防 SQLite 999 变量限制
        // 每个点使用 4 个变量 (code, time, price, vol)，故 CHUNK = 200 时约 800 个变量
        const CHUNK = 200;
        for (let i = 0; i < points.length; i += CHUNK) {
            const chunk = points.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(',');
            const flatParams = [];
            chunk.forEach(p => {
                flatParams.push(p.code, p.time, p.price, p.vol || 0);
            });

            await runSql(`INSERT OR REPLACE INTO asset_intraday_points (code, time, price, vol) VALUES ${placeholders}`, flatParams);
        }
    } catch (e) {
        console.error(`[IntradayRepo] saveIntradayPointsBulk failed:`, e.message);
    }
}

/**
 * 清理分时数据，每个股票仅保留最近 480 条 (Cron 专用)
 */
export async function pruneIntradayPoints() {
    try {
        const codes = await queryAll('SELECT DISTINCT code FROM asset_intraday_points');
        const db = await getD1Storage();
        if (!db) return;

        const statements = codes.map(c =>
            db.prepare(`
                DELETE FROM asset_intraday_points 
                WHERE code = ? AND time NOT IN (
                    SELECT time FROM asset_intraday_points 
                    WHERE code = ? 
                    ORDER BY time DESC LIMIT 480
                )
            `).bind(c.code, c.code)
        );

        // 分片执行批量清理
        for (let i = 0; i < statements.length; i += 50) {
            await db.batch(statements.slice(i, i + 50));
        }
    } catch (e) {
        console.error(`[IntradayRepo] pruneIntradayPoints failed:`, e.message);
    }
}
