import { queryOne, getCloudflareCtx } from '@/lib/storage/d1Client';

/**
 * 常量时间比较（防 timing attack）
 */
function safeCompare(a, b) {
    if (!a || !b || a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * 校验管理员权限
 *
 * 安全约定：**只接受请求头**（x-admin-session / x-admin-key）。
 * 此前还接受 ?sess / ?key / ?token / ?adminKey / ?secret 等 query 参数，
 * 而管理员密钥是全局 PSK——一旦经 URL 传递就会落进 Cloudflare Workers 日志
 * （本 worker 的 observability 未开启 query 脱敏）、浏览器历史与 Referer。
 *
 * @param {Request} request 
 * @param {Object} env Cloudflare environment
 */
export async function isAdminAuthorized(request, env = null) {
    /**
     * 1. Session Token 验证 (优先)：仅请求头
     */
    const sessionToken = request.headers.get('x-admin-session');

    if (sessionToken && sessionToken.length < 128) {
        try {
            const session = await queryOne(
                `SELECT 1
                 FROM admin_sessions
                 WHERE token = ?
                 AND expires_at > CURRENT_TIMESTAMP
                 LIMIT 1`,
                [sessionToken],
                env
            );

            if (session) {
                return true;
            }
        } catch (err) {
            console.error('[AdminAuth] session lookup failed', err);
        }
    }

    /**
     * 2. 后备方案：PSK 密钥（仅请求头）
     */
    const inputKey = request.headers.get('x-admin-key');
    if (!inputKey) {
        return false;
    }

    /**
     * 3. 获取 Worker 环境变量
     */
    let envKey = env?.ADMIN_API_KEY || process.env.ADMIN_API_KEY;

    if (!envKey) {
        try {
            const ctx = await getCloudflareCtx(env);
            envKey = ctx?.env?.ADMIN_API_KEY;
        } catch (err) {
            console.error('[AdminAuth] env read failed', err);
        }
    }

    if (!envKey) {
        console.error('[AdminAuth] ADMIN_API_KEY not configured');
        return false;
    }

    /**
     * 4. 常量时间比较
     */
    return safeCompare(inputKey.trim(), envKey.trim());
}
