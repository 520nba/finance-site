import { queryAll, runSql, queryOne } from './d1Client';
import { addSystemLog } from './logRepo';

/**
 * 更新或插入 API 健康现状
 */
export async function updateApiHealth(name, data) {
    try {
        // [Debug] 极致追踪：记录即将写入的数据
        const sql = `
            REPLACE INTO api_health (api_name, status, success_rate, avg_latency, last_check, error_msg)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `;
        const params = [name, data.status, data.successRate, data.avgLatency, data.errorMsg || ''];

        console.log(`[HealthRepo] Upserting: ${name} (${data.status})`);
        const res = await runSql(sql, params);

        if (res && res.success) {
            console.log(`[HealthRepo] Upsert success for ${name}`);
        } else {
            console.warn(`[HealthRepo] Upsert result success state is false for ${name}`);
        }
    } catch (e) {
        console.error(`[HealthRepo] updateApiHealth failed for ${name}:`, e.message);
        // 通过系统日志透传错误
        try { await addSystemLog('ERROR', 'HealthRepo', `Write fail ${name}: ${e.message}`); } catch (logErr) { }
    }
}

/**
 * 获取所有 API 状态
 */
export async function getAllApiHealth() {
    try {
        const rows = await queryAll('SELECT * FROM api_health ORDER BY api_name ASC');
        console.log(`[HealthRepo] Fetched ${rows?.length || 0} health rows from D1`);
        return rows || [];
    } catch (e) {
        console.error('[HealthRepo] getAllApiHealth failed:', e.message);
        return [];
    }
}
