import { queryAll, runSql, queryOne } from './d1Client';
import { addSystemLog } from './logRepo';

/**
 * 更新 API 健康现状 (生产级优化版)
 * 1. 自动计算滚动成功率 (success_count / total_count)
 * 2. 状态变化或周期心跳时写入数据库
 * 3. 记录心跳时间戳 heartbeat_ts
 */
export async function updateApiHealth(name, data) {
    try {
        const isSuccess = data.successRate === 100;
        const currentResult = isSuccess ? 'S' : 'F';

        // 使用原子更新语句，实现基于最近 10 次的滚动成功率 (Sliding Window)
        const sql = `
            INSERT INTO api_health (
                api_name, status, success_rate, avg_latency, 
                success_count, fail_count, total_count,
                recent_results,
                last_check, heartbeat_ts, error_msg
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(api_name) DO UPDATE SET
                status = excluded.status,
                avg_latency = (avg_latency * total_count + excluded.avg_latency) / (total_count + 1),
                success_count = success_count + excluded.success_count,
                fail_count = fail_count + excluded.fail_count,
                total_count = total_count + 1,
                recent_results = substr(COALESCE(recent_results, '') || excluded.recent_results, -10),
                success_rate = (
                    length(substr(COALESCE(recent_results, '') || excluded.recent_results, -10)) - 
                    length(replace(substr(COALESCE(recent_results, '') || excluded.recent_results, -10), 'S', ''))
                ) * (100.0 / length(substr(COALESCE(recent_results, '') || excluded.recent_results, -10))),
                last_check = excluded.last_check,
                heartbeat_ts = excluded.heartbeat_ts,
                error_msg = excluded.error_msg
        `;

        const params = [
            name,
            data.status,
            isSuccess ? 100 : 0,
            data.avgLatency,
            isSuccess ? 1 : 0,
            isSuccess ? 0 : 1,
            currentResult,
            data.errorMsg || ''
        ];

        await runSql(sql, params);

        // 日志策略优化：只有在异常时才记录 SystemLog，减少存储开销
        if (!isSuccess) {
            await addSystemLog('WARN', 'HealthRepo', `API Down: ${name} [${data.status}] - ${data.errorMsg}`);
        }

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
