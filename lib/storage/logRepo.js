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
    // 智能写策略：WARN/ERROR 必写；核心调度模块(Cron/Sentinel)的 INFO 也写，方便追踪执行记录
    const levelUp = level?.toUpperCase();
    const isCoreModule = ['SyncCron', 'DailyCron', 'Sentinel', 'HealthCron'].includes(module);
    const shouldPersist = ['WARN', 'ERROR'].includes(levelUp) || (levelUp === 'INFO' && isCoreModule);

    try {
        if (shouldPersist) {
            await runSql(
                'INSERT INTO system_logs (level, module, message) VALUES (?, ?, ?)',
                [levelUp, module, message]
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
