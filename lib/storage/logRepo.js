import { runSql, queryAll } from './d1Client';

/**
 * 系统日志存储仓库
 * 用于记录关键业务逻辑，如外部接口抓取记录。
 */

/**
 * 添加系统日志
 * 将日志保存到 D1 数据库 system_logs 表。
 */
export async function addSystemLog(level, module, message) {
    // 低频写策略：仅 WARN 和 ERROR 写入 D1，节省写入额度
    const shouldPersist = ['WARN', 'ERROR'].includes(level?.toUpperCase());

    try {
        if (shouldPersist) {
            await runSql(
                'INSERT INTO system_logs (level, module, message) VALUES (?, ?, ?)',
                [level, module, message]
            );
        }
        console.log(`[LOG][${level}][${module}] ${message}${shouldPersist ? ' (PERSISTED)' : ''}`);
    } catch (e) {
        console.warn('[LogRepo] Failed to save log to D1:', e.message);
        // Fallback to console only
        console.log(`[LOG-FALLBACK][${level}][${module}] ${message}`);
    }
}

/**
 * 获取系统日志
 * 从 D1 读取最近 N 小时的日志。
 */
export async function getSystemLogs(hours = 72) {
    try {
        return await queryAll(
            'SELECT * FROM system_logs WHERE timestamp >= datetime("now", "-" || ? || " hours") ORDER BY timestamp DESC',
            [hours]
        );
    } catch (e) {
        console.error('[LogRepo] getSystemLogs failed:', e.message);
        return [];
    }
}
