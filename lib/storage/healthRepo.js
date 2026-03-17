import { queryAll, runSql, queryOne, getRequiredDb } from './d1Client';
import { addSystemLog } from './logRepo';

/**
 * 内部辅助：构造 API 状态更新的 SQL 和参数
 */
function prepareHealthUpsert(name, data) {
    const isSuccess = data.isSuccess !== undefined ? data.isSuccess : data.status !== 'down';
    const currentResult = isSuccess ? 'S' : 'F';

    const sql = `
        INSERT INTO api_health (
            api_name, status, success_rate, avg_latency, 
            success_count, fail_count, total_count,
            recent_results,
            last_check, heartbeat_ts, error_msg
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(api_name) DO UPDATE SET
            status = excluded.status,
            avg_latency = (avg_latency * 0.8) + (excluded.avg_latency * 0.2), -- 采用指数移动平均，更反映近况
            success_count = success_count + excluded.success_count,
            fail_count = fail_count + excluded.fail_count,
            total_count = total_count + 1,
            recent_results = substr(COALESCE(recent_results, '') || excluded.recent_results, -20),
            success_rate = (
                length(replace(substr(COALESCE(recent_results, '') || excluded.recent_results, -20), 'F', ''))
            ) || '/' || length(substr(COALESCE(recent_results, '') || excluded.recent_results, -20)),
            last_check = excluded.last_check,
            heartbeat_ts = excluded.heartbeat_ts,
            error_msg = excluded.error_msg
    `;

    const params = [
        name,
        data.status,
        isSuccess ? "1/1" : "0/1",
        data.avgLatency,
        isSuccess ? 1 : 0,
        isSuccess ? 0 : 1,
        currentResult,
        data.errorMsg || ''
    ];

    return { sql, params, isSuccess };
}

export async function updateApiHealth(name, data, env = null) {
    try {
        const { sql, params, isSuccess } = prepareHealthUpsert(name, data);
        await runSql(sql, params, env);

        if (!isSuccess) {
            await addSystemLog('WARN', 'HealthRepo', `API Down: ${name} [${data.status}] - ${data.errorMsg}`, env);
        }
    } catch (e) {
        console.error(`[HealthRepo] updateApiHealth failed for ${name}:`, e.message);
    }
}

/**
 * 批量更新 API 健康现状 (原子事务)
 * @param {Array} results
 * @param {Object} env
 */
export async function batchUpdateApiHealth(results, env = null) {
    try {
        const db = await getRequiredDb(env);

        const statements = results.map(r => {
            const { sql, params } = prepareHealthUpsert(r.name, r);
            return db.prepare(sql).bind(...params);
        });

        await db.batch(statements);

        // 批量记录日志
        const failures = results.filter(r => (r.isSuccess !== undefined ? !r.isSuccess : r.status === 'down'));
        for (const f of failures) {
            await addSystemLog('WARN', 'HealthRepo', `API Down: ${f.name} [${f.status}] - ${f.errorMsg}`, env);
        }
    } catch (e) {
        console.error('[HealthRepo] batchUpdateApiHealth failed:', e.message);
    }
}

/**
 * 获取所有 API 状态
 * @param {Object} env
 */
export async function getAllApiHealth(env = null) {
    try {
        const rows = await queryAll('SELECT * FROM api_health ORDER BY api_name ASC', [], env);
        return rows || [];
    } catch (e) {
        console.error('[HealthRepo] getAllApiHealth failed:', e.message);
        return [];
    }
}
