/**
 * lib/auth/requireUser.js
 * 
 * 服务端会话验证中间件
 */

import { queryOne } from '@/lib/storage/d1Client';
import { memoryCache } from '@/lib/storage/memoryCache';

/**
 * 验证请求中的会话并返回 userId
 * @param {Request} request 
 * @returns {Promise<string|null>}
 */
export async function requireUser(request) {
    const token = request.cookies.get('session')?.value
        ?? request.headers.get('x-session-token');

    if (!token || token.length !== 64) return null;

    // L1：内存缓存 session（TTL 5分钟，减少 D1 查询）
    const cacheKey = `sess:${token}`;
    const cached = memoryCache.get(cacheKey);
    if (cached) return cached;

    // 检查 D1 数据库
    const row = await queryOne(
        `SELECT user_id FROM user_sessions 
         WHERE token = ? AND expires_at > datetime('now') LIMIT 1`,
        [token]
    );

    if (!row) return null;

    // 写入 L1 缓存
    memoryCache.set(cacheKey, row.user_id, 5 * 60 * 1000);
    return row.user_id;
}
