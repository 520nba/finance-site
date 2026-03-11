import { queryOne, queryAll, runSql, getD1Storage } from './d1Client';

/**
 * 原子化提取并锁定任务 (分布式环境安全)
 * 逻辑：直接通过 UPDATE ... RETURNING 语句抢占任务并标记状态
 * 优先级：pending > 僵死重试 > 错误重试
 */
export async function grabAndLockSyncTasks(limit = 10) {
    const db = getD1Storage();
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
        return await runSql('DELETE FROM sync_queue WHERE code = ? AND type = ?', [code, type]);
    }
    return await runSql(
        'UPDATE sync_queue SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND type = ?',
        [status, code, type]
    );
}

/**
 * 将资产添加到同步任务队列
 */
export async function addToSyncQueue(items) {
    if (!items || !items.length) return; // 空保护

    const db = getD1Storage();
    if (!db) return;

    // 分片处理，严格遵守 D1 100 statements 限制，取 50 以保万全
    for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const stmts = chunk.map(item =>
            db.prepare('INSERT OR IGNORE INTO sync_queue (code, type, status) VALUES (?, ?, ?)')
                .bind(item.code, item.type, 'pending')
        );
        await db.batch(stmts);
    }
}

/**
 * 历史价格批量写入
 * 严格分片 (每片 50 条)，确保不触发 D1 100 statements 限制
 */
export async function insertDailyPricesBatch(records) {
    if (!records || !records.length) return;

    const db = getD1Storage();
    if (!db) return;

    for (let i = 0; i < records.length; i += 50) {
        const chunk = records.slice(i, i + 50);
        const stmts = chunk.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                .bind(r.code, r.type, r.price, r.date)
        );

        try {
            const results = await db.batch(stmts);
            if (!results || results.some(res => !res.success)) {
                throw new Error('Partial failure in D1 batch');
            }
        } catch (e) {
            console.error(`[HistoryRepo] Batch insert failed at index ${i}:`, e.message);
            throw e;
        }
    }
}

/**
 * 基金历史更新 (含全量逻辑与原子清理)
 * 严格限制分片数量，确保包含清理语句后总数不超过 100
 */
export async function incrementalUpdateFundHistory(code, records) {
    if (!records || !records.length) return false;
    const db = getD1Storage();
    if (!db) return false;

    // 清理语句定义
    const cleanupSql = `
        DELETE FROM asset_history 
        WHERE code = ? AND type = 'fund' 
        AND rowid NOT IN (
            SELECT rowid FROM asset_history 
            WHERE code = ? AND type = 'fund' 
            ORDER BY record_date DESC 
            LIMIT 250
        )
    `;

    // 严谨分片：每组 80 条，留出空间给清理操作
    for (let i = 0; i < records.length; i += 80) {
        const chunk = records.slice(i, i + 80);
        const stmts = chunk.map(r =>
            db.prepare('INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                .bind(code, 'fund', r.price, r.date)
        );

        // 如果是最后一组，带上清理逻辑一起提交，确保原子性
        if (i + 80 >= records.length) {
            stmts.push(db.prepare(cleanupSql).bind(code, code));
        }

        const results = await db.batch(stmts);
        if (!results.every(r => r.success)) return false;
    }
    return true;
}

/**
 * 批量读取历史数据 (带分片保护)
 */
export async function getBulkHistory(items, days = 250) {
    if (!items || !items.length) return {};
    const db = getD1Storage();
    if (!db) return {};

    const result = {};

    // 每批 50 只资产，防止超过 D1 batch 100 限制
    for (let i = 0; i < items.length; i += 50) {
        const chunk = items.slice(i, i + 50);
        const stmts = chunk.map(item =>
            db.prepare(`
                SELECT value, date FROM (
                    SELECT price as value, record_date as date 
                    FROM asset_history 
                    WHERE code = ? AND type = ? 
                    ORDER BY record_date DESC LIMIT ?
                ) ORDER BY date ASC
            `).bind(item.code, item.type, days)
        );

        try {
            const batchResults = await db.batch(stmts);
            chunk.forEach((item, index) => {
                const res = batchResults[index];
                if (res && res.success) {
                    result[`${item.type}:${item.code}`] = res.results || [];
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
        SELECT value, date FROM (
            SELECT price as value, record_date as date 
            FROM asset_history 
            WHERE code = ? AND type = ? 
            ORDER BY record_date DESC LIMIT ?
        ) ORDER BY date ASC
    `;
    return await queryAll(querySql, [code, type, days]);
}
