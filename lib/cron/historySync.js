/**
 * src/lib/cron/historySync.js
 *
 * 历史数据增量同步 (生产者模式)
 * 职责：扫描 user_assets 并向 D1 任务中心投递同步指令。
 *
 * 由 scheduled handler 在以下时间调用：
 *   周一到周五 21:00（北京）— 收盘后全量刷新
 *   周一到周六 03:00（北京）— 凌晨补跑，确保数据完整
 *
 * 优化说明：
 *   由于 Cloudflare Workers 免费版单次请求限制 50 次子请求，
 *   旧版“拉取并在主线程写入”模式仅能处理 ~10 个资产。
 *   新版模式仅消耗 1 次 DB 查询 + 1 次 DB Batch 写入，可轻松处理数千资产。
 */

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runHistorySync(env, options = {}) {
    const { force, type } = options;
    const t0 = Date.now();

    try {
        // 1. 获取所有待同步资产
        let query = 'SELECT DISTINCT code, type FROM user_assets';
        let params = [];
        if (type) {
            query += ' WHERE type = ?';
            params.push(type);
        }

        const { results: assets } = await env.DB
            .prepare(query)
            .bind(...params)
            .all();

        if (!assets?.length) {
            await _log(env, 'INFO', 'HistorySync', 'No assets in user_assets, skipping.');
            return;
        }

        console.log(`[HistorySync:Producer] Injecting ${assets.length} jobs ${force ? '(FORCE)' : ''}`);

        // 2. 批量投递任务到 sync_jobs 表
        // type: asset_history_sync
        const stmts = assets.map(asset =>
            env.DB.prepare(`
                INSERT OR IGNORE INTO sync_jobs (type, code, payload, status) 
                VALUES (?, ?, ?, 'pending')
            `).bind(
                'asset_history_sync',
                asset.code.toLowerCase(),
                JSON.stringify({ type: asset.type, force })
            )
        );

        // D1 Batch 极其高效，仅消耗 1 个子请求配额
        await env.DB.batch(stmts);

        const elapsed = Math.round((Date.now() - t0) / 1000);
        const summary = `成功向任务队列投递 ${assets.length} 个同步指令 (耗时 ${elapsed}s)`;
        console.log(`[HistorySync:Producer] ${summary}`);
        await _log(env, 'INFO', 'HistorySync', summary);

        // 3. 顺便执行定期清理任务
        await env.DB.prepare("DELETE FROM system_logs WHERE timestamp < datetime('now', '+8 hours', '-30 days')").run();

    } catch (e) {
        console.error('[HistorySync:Producer] Fatal Error:', e.message);
        await _log(env, 'ERROR', 'HistorySync', `Producer Error: ${e.message}`);
    }
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

async function _log(env, level, module, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, module, message, timestamp) VALUES (?, ?, ?, datetime("now", "+8 hours"))')
            .bind(level, module, message)
            .run();
    } catch (e) {
        console.error('[HistorySync] log write failed:', e.message);
    }
}
