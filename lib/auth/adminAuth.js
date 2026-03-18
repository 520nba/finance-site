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
 * @param {Request} request 
 * @param {Object} env Cloudflare environment
 */
export async function isAdminAuthorized(request, env = null) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    /**
     * 1. Session Token 验证 (优先)
     */
    const sessionToken =
        request.headers.get('x-admin-session') ||
        searchParams.get('sess');

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
     * 2. 后备方案：PSK 密钥
     */
    const adminKey = request.headers.get('x-admin-key');
    const queryKey =
        searchParams.get('token') ||
        searchParams.get('adminKey') ||
        searchParams.get('key') ||
        searchParams.get('secret');

    const inputKey = adminKey || queryKey;

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
