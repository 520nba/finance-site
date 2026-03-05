/**
 * 系统日志存储仓库 (已禁用存库，仅保留 console 控制台输出)
 * 为了极致性能不再将日志保存到后端存储以节省写入额度。
 */

/**
 * 添加系统日志
 * 现在仅输出到控制台 (console.log)，不再执行任何写入操作。
 */
export async function addSystemLog(level, module, message) {
    // 仅保留控制台输出，用于调试和 Edge 日志流查看
    console.log(`[LOG][${level}][${module}] ${message}`);
}

/**
 * 获取系统日志
 * 由于禁用了持久化存储，此函数现在总是返回空数组。
 */
export async function getSystemLogs(hours = 48) {
    // 不再读取日志，返回空以保证兼容性
    return [];
}
