/**
 * 前端通用基础日志工具，用于增强追踪能力
 */
export const logger = {
    info: (msg, context = {}) => {
        const requestId = Math.random().toString(36).substring(2, 9);
        const userId = context.userId || 'anonymous';
        console.log(`[INFO] [ReqID: ${requestId}] [User: ${userId}] ${msg}`, JSON.stringify(context));
    },
    error: (msg, error, context = {}) => {
        const requestId = Math.random().toString(36).substring(2, 9);
        const userId = context.userId || 'anonymous';
        const errorType = error?.name || 'UnknownError';
        console.error(`[ERROR] [ReqID: ${requestId}] [User: ${userId}] [Type: ${errorType}] ${msg}`, error?.message || error, JSON.stringify(context));
    }
};
