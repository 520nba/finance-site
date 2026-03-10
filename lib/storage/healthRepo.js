import { queryAll, runSql, queryOne } from './d1Client';

/**
 * 更新或插入 API 健康现状
 */
export async function updateApiHealth(name, data) {
    try {
        await runSql(`
            INSERT INTO api_health (api_name, status, success_rate, avg_latency, last_check, error_msg)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(api_name) DO UPDATE SET
                status = excluded.status,
                success_rate = excluded.success_rate,
                avg_latency = excluded.avg_latency,
                last_check = CURRENT_TIMESTAMP,
                error_msg = excluded.error_msg
        `, [name, data.status, data.successRate, data.avgLatency, data.errorMsg || '']);
    } catch (e) {
        console.error(`[HealthRepo] updateApiHealth failed for ${name}:`, e.message);
    }
}

/**
 * 获取所有 API 状态
 */
export async function getAllApiHealth() {
    try {
        return await queryAll('SELECT * FROM api_health ORDER BY api_name ASC');
    } catch (e) {
        console.error('[HealthRepo] getAllApiHealth failed:', e.message);
        return [];
    }
}
