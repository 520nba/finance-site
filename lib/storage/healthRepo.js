import { queryAll, runSql, queryOne } from './d1Client';
import { addSystemLog } from './logRepo';

/**
 * 更新或插入 API 健康现状
 */
export async function updateApiHealth(name, data) {
    try {
        const sql = `
            REPLACE INTO api_health (api_name, status, success_rate, avg_latency, last_check, error_msg)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `;
        const params = [name, data.status, data.successRate, data.avgLatency, data.errorMsg || ''];

        const res = await runSql(sql, params);

        // 关键：强制写一条系统日志确认写入动作
        await addSystemLog('DEBUG', 'HealthRepo', `Upserted ${name} [${data.status}] Changes: ${res?.meta?.changes || 0}`);

    } catch (e) {
        console.error(`[HealthRepo] updateApiHealth failed for ${name}:`, e.message);
        await addSystemLog('ERROR', 'HealthRepo', `Write fail ${name}: ${e.message}`);
    }
}

/**
 * 获取所有 API 状态
 */
export async function getAllApiHealth() {
    try {
        const rows = await queryAll('SELECT * FROM api_health ORDER BY api_name ASC');
        return rows || [];
    } catch (e) {
        console.error('[HealthRepo] getAllApiHealth failed:', e.message);
        return [];
    }
}
