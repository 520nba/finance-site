import { queryOne, queryAll, runSql, getD1Storage, getRequiredDb } from './d1Client';
import { memoryCache } from './memoryCache';
import { chunkArray } from '../utils';

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
        // 使用 toLocaleString 获取稳健的北京时间
        const bjNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
        const timeValue = bjNow.getHours() * 100 + bjNow.getMinutes();
        const isMarketClosed = timeValue >= 1515 || timeValue < 900;

        if (isMarketClosed || forcePersist) {
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
                const sql = `SELECT code, data FROM asset_intraday WHERE record_date = ? AND code IN (${placeholders})`;
                const rows = await queryAll(sql, [date, ...codes], env);
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
 * 拼装巨型 SQL 批量插入分时点 (Cron 专用)
 */
export async function saveIntradayPointsBulk(points, env = null) {
    if (!points || points.length === 0) return;

    // 维度 4 优化：循环外提取 DB 绑定，减少重复获取开销
    const db = await getRequiredDb(env);

    try {
        const CHUNK = 200;
        for (let i = 0; i < points.length; i += CHUNK) {
            const chunk = points.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(',');

            // 使用 flatMap 使代码更简洁
            const flatParams = chunk.flatMap(p => [p.code, p.time, p.price, p.vol || 0]);

            await db.prepare(`INSERT OR REPLACE INTO asset_intraday_points (code, time, price, vol) VALUES ${placeholders}`)
                .bind(...flatParams)
                .run();
        }
    } catch (e) {
        console.error(`[IntradayRepo] saveIntradayPointsBulk failed:`, e.message);
    }
}

/**
 * 清理分时数据
 */
export async function pruneIntradayPoints(env = null) {
    try {
        const codes = await queryAll('SELECT DISTINCT code FROM asset_intraday_points', [], env);
        const db = await getRequiredDb(env);

        const statements = codes.map(c =>
            db.prepare(`
                DELETE FROM asset_intraday_points 
                WHERE code = ? AND ROWID NOT IN (
                    SELECT ROWID FROM asset_intraday_points 
                    WHERE code = ? 
                    ORDER BY ROWID DESC LIMIT 480
                )
            `).bind(c.code, c.code)
        );

        for (let i = 0; i < statements.length; i += 50) {
            await db.batch(statements.slice(i, i + 50));
        }
    } catch (e) {
        console.error(`[IntradayRepo] pruneIntradayPoints failed:`, e.message);
    }
}
