import { queryOne, queryAll, runSql, getD1Storage } from './d1Client';


/**
 * 物理删除特定资产的所有历史记录
 */
export async function deleteAssetHistory(code, type, env = null) {
    const db = await getD1Storage(env);
    if (!db) return false;
    try {
        await db.prepare('DELETE FROM asset_history WHERE code = ? AND type = ?')
            .bind(code.toLowerCase(), type)
            .run();
        return true;
    } catch (e) {
        console.error(`[HistoryRepo] deleteAssetHistory failed for ${code}:`, e.message);
        return false;
    }
}


/**
 * 历史价格批量写入 (含日期阈值物理截断)
 */
export async function insertDailyPricesBatch(records, env = null) {
    if (!records || !records.length) return;

    const db = await getD1Storage(env);
    if (!db) return;

    // 1. 分类 records 并确定各资产
    const assetGroups = {};
    records.forEach(r => {
        const key = `${r.type}:${r.code}`;
        if (!assetGroups[key]) assetGroups[key] = [];
        assetGroups[key].push(r);
    });

    // 2. 使用 D1 batch 执行：插入新数据 + 同步物理截断
    for (const key in assetGroups) {
        const [type, code] = key.split(':');
        const group = assetGroups[key];

        // 分片处理以便不超出 D1 batch 限制
        for (let i = 0; i < group.length; i += 80) {
            const chunk = group.slice(i, i + 80);
            const stmts = chunk.map(r =>
                db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                    .bind(r.code.toLowerCase(), r.type, r.price, r.date)
            );

            // 如果是该资产的最后一组，追加物理截断语句实现原子操作
            if (i + 80 >= group.length) {
                stmts.push(db.prepare(`
                    DELETE FROM asset_history
                    WHERE code = ? AND type = ?
                    AND record_date < (
                        SELECT record_date
                        FROM asset_history
                        WHERE code = ? AND type = ?
                        ORDER BY record_date DESC
                        LIMIT 1 OFFSET 249
                    )
                `).bind(code.toLowerCase(), type, code.toLowerCase(), type));
            }

            await db.batch(stmts);
        }
    }
}

/**
 * 基金历史更新 (含全量逻辑与原子清理)
 * 严格限制分片数量，确保包含清理语句后总数不超过 100
 */
export async function incrementalUpdateFundHistory(code, records, env = null) {
    if (!records || !records.length) return false;
    // 直接复用 insertDailyPricesBatch 实现口径对齐
    await insertDailyPricesBatch(records.map(r => ({ ...r, code, type: 'fund' })), env);
    return true;
}

/**
 * 批量读取历史数据 (带分片保护)
 */
export async function getBulkHistory(items, days = 250, env = null) {
    if (!items || !items.length) return {};
    const db = await getD1Storage(env);
    if (!db) return {};

    const result = {};

    // 每批 50 只资产，防止超过 D1 batch 100 限制
    for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const stmts = chunk.map(item =>
            db.prepare(`
                SELECT price as value, record_date as date
                FROM asset_history
                WHERE code = ? AND type = ?
                ORDER BY record_date DESC LIMIT ?
            `).bind(item.code.toLowerCase(), item.type, days)
        );

        try {
            const batchResults = await db.batch(stmts);
            if (!batchResults) continue;

            chunk.forEach((item, index) => {
                const res = batchResults[index];
                if (res && res.results) {
                    // 由于 SQL 是按日期降序取的（为了 LIMIT），这里需要反转为升序供前端和统计使用
                    result[`${item.type}:${item.code}`] = res.results.reverse();
                }
            });
        } catch (e) {
            console.error('[HistoryRepo] getBulkHistory chunk error:', e.message);
        }
    }
    return result;
}

/**
 * 读取单只资产历史
 */
export async function getHistory(code, type, days = 250, env = null) {
    const querySql = `
        SELECT price as value, record_date as date
        FROM asset_history
        WHERE code = ? AND type = ?
        ORDER BY record_date DESC LIMIT ?
    `;
    const rows = await queryAll(querySql, [code.toLowerCase(), type, days], env);
    return rows ? rows.reverse() : [];
}
