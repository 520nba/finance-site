import { queryOne, queryAll, runSql } from './d1Client';
import { memoryCache } from './memoryCache';

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
export async function saveIntraday(code, date, data) {
    const memKey = `intra:${code}:${date}`;

    try {
        const bjTime = new Date(Date.now() + (8 * 3600 * 1000));
        const timeValue = bjTime.getUTCHours() * 100 + bjTime.getUTCMinutes();
        const isMarketClosed = timeValue >= 1515 || timeValue < 900;

        // 如果是收盘后，持久化到 D1
        if (isMarketClosed) {
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
 * 批量获取分时数据
 */
export async function getBulkIntraday(items, date) {
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
        try {
            const sql = `SELECT code, data FROM asset_intraday WHERE record_date = ? AND code IN (${toQuery.map(() => '?').join(',')})`;
            const rows = await queryAll(sql, [date, ...toQuery]);
            for (const row of rows) {
                result[row.code] = JSON.parse(row.data);
            }
        } catch (e) {
            console.error('[IntradayRepo] getBulkIntraday failed:', e.message);
        }
    }

    return result;
}
