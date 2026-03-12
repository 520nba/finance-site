import { queryOne, queryAll, runSql, getD1Storage } from './d1Client';

/**
 * 原子化提取并锁定任务 (分布式环境安全)
 * 逻辑：直接通过 UPDATE ... RETURNING 语句抢占任务并标记状态
 * 优先级：pending > 僵死重试 > 错误重试
 */
export async function grabAndLockSyncTasks(limit = 10) {
    const db = await getD1Storage();
    if (!db) return [];

    // 这一条 SQL 实现了：锁定(Update) + 提取(Returning)
    // 利用 SQLite 原生原子性，Worker 之间绝不会抢到重复任务
    const sql = `
        UPDATE sync_queue
        SET status = 'syncing', updated_at = CURRENT_TIMESTAMP
        WHERE rowid IN (
            SELECT rowid FROM sync_queue
            WHERE status = 'pending'
               OR (status = 'error' AND updated_at < datetime('now', '-1 hour'))
               OR (status = 'syncing' AND updated_at < datetime('now', '-10 minutes'))
            ORDER BY 
                CASE status 
                    WHEN 'pending' THEN 0 
                    WHEN 'syncing' THEN 1 
                    WHEN 'error' THEN 2 
                END,
                updated_at ASC
            LIMIT ?
        )
        RETURNING code, type, status;
    `;

    try {
        const results = await db.prepare(sql).bind(limit).all();
        return results.results || [];
    } catch (e) {
        console.error('[HistoryRepo] Atomic grab failed:', e.message);
        return [];
    }
}

/**
 * 更新同步状态
 */
export async function updateSyncStatus(code, type, status) {
    if (status === 'done') {
        const res = await runSql('DELETE FROM sync_queue WHERE code = ? AND type = ?', [code.toLowerCase(), type]);
        // 维度 3 优化: 同步成功从队列移除后，计数器 -1
        const { decrementCounter } = await import('./statsRepo');
        await decrementCounter('queue_count');
        return res;
    }
    return await runSql(
        'UPDATE sync_queue SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND type = ?',
        [status, code.toLowerCase(), type]
    );
}

/**
 * 将资产添加到同步任务队列
 */
export async function addToSyncQueue(items) {
    if (!items || !items.length) return;

    const db = await getD1Storage();
    if (!db) return;

    // 分片处理，严格遵守 D1 100 statements 限制，取 50 以保万全
    for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const stmts = chunk.map(item =>
            db.prepare('INSERT OR IGNORE INTO sync_queue (code, type, status) VALUES (?, ?, ?)')
                .bind(item.code.toLowerCase(), item.type, 'pending')
        );
        await db.batch(stmts);
    }

    // 维度 3 优化: 全量校准计数器，防止 INSERT OR IGNORE 导致的计数偏差
    const { syncCounterFromTable } = await import('./statsRepo');
    await syncCounterFromTable('queue_count', 'sync_queue');
}

/**
 * 历史价格批量写入
 * 严格分片 (每片 50 条)，确保不触发 D1 100 statements 限制
 */
/**
 * 历史价格批量写入 (含日期阈值物理截断)
 * 逻辑：
 * 1. 针对每只资产，从抓取到的 records 中找到第 250 条（最早一条）的日期。
 * 2. 批量写入 records。
 * 3. 物理删除数据库中早于该阈值的历史记录。
 */
export async function insertDailyPricesBatch(records) {
    if (!records || !records.length) return;

    const db = await getD1Storage();
    if (!db) return;

    // 1. 分类 records 并确定各资产的日期阈值
    const assetGroups = {};
    records.forEach(r => {
        const key = `${r.type}:${r.code}`;
        if (!assetGroups[key]) assetGroups[key] = [];
        assetGroups[key].push(r);
    });

    const thresholds = {};
    for (const key in assetGroups) {
        // records 通常按日期升序排列，取第一条作为 250 条的最早边界
        thresholds[key] = assetGroups[key][0].date;
    }

    // 2. 批量插入/替换数据 (每 50 条一个批次)
    for (let i = 0; i < records.length; i += 50) {
        const chunk = records.slice(i, i + 50);
        const stmts = chunk.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                .bind(r.code.toLowerCase(), r.type, r.price, r.date)
        );
        try {
            await db.batch(stmts);
        } catch (e) {
            console.error(`[HistoryRepo] Batch insert failed:`, e.message);
            throw e;
        }
    }

    // 3. 执行物理截断
    for (const key in thresholds) {
        const [type, code] = key.split(':');
        const minDate = thresholds[key];
        try {
            await runSql(
                'DELETE FROM asset_history WHERE code = ? AND type = ? AND record_date < ?',
                [code.toLowerCase(), type, minDate]
            );
        } catch (e) {
            console.error(`[HistoryRepo] Cleanup failed for ${key}:`, e.message);
        }
    }
}

/**
 * 基金历史更新 (含全量逻辑与原子清理)
 * 严格限制分片数量，确保包含清理语句后总数不超过 100
 */
export async function incrementalUpdateFundHistory(code, records) {
    if (!records || !records.length) return false;
    const db = await getD1Storage();
    if (!db) return false;

    // 2. 高效清理：保留最近 250 条
    // 逻辑：定位第 250 条数据的日期，删除比它更早的所有记录。
    // 这能完美利用 (code, type, record_date) 索引，避免 NOT IN 的全表扫描。
    const cleanupSql = `
        DELETE FROM asset_history 
        WHERE code = ? AND type = 'fund' 
        AND record_date < (
            SELECT record_date 
            FROM asset_history 
            WHERE code = ? AND type = 'fund' 
            ORDER BY record_date DESC 
            LIMIT 1 OFFSET 249
        )
    `;

    // 严谨分片：每组 80 条，留出空间给清理操作
    for (let i = 0; i < records.length; i += 80) {
        const chunk = records.slice(i, i + 80);
        const stmts = chunk.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                .bind(code.toLowerCase(), 'fund', r.price, r.date)
        );

        // 如果是最后一组，带上清理逻辑一起提交，确保原子性
        if (i + 80 >= records.length) {
            stmts.push(db.prepare(cleanupSql).bind(code, code));
        }

        const results = await db.batch(stmts);
        if (!results) return false;
    }
    return true;
}

/**
 * 批量读取历史数据 (带分片保护)
 */
export async function getBulkHistory(items, days = 250) {
    if (!items || !items.length) return {};
    const db = await getD1Storage();
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
export async function getHistory(code, type, days = 250) {
    const querySql = `
        SELECT price as value, record_date as date 
        FROM asset_history 
        WHERE code = ? AND type = ? 
        ORDER BY record_date DESC LIMIT ?
    `;
    const rows = await queryAll(querySql, [code.toLowerCase(), type, days]);
    return rows ? rows.reverse() : [];
}
