import { queryAll, runSql, queryOne } from './d1Client';

/**
 * 更新或插入 API 健康现状
 */
export async function updateApiHealth(name, data) {
    try {
        const res = await runSql(`
            REPLACE INTO api_health (api_name, status, success_rate, avg_latency, last_check, error_msg)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `, [name, data.status, data.successRate, data.avgLatency, data.errorMsg || '']);

        if (res && !res.success) {
            console.warn(`[HealthRepo] Write reported no success for ${name}`);
        }
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
