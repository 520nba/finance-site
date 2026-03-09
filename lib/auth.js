import { queryOne, getCloudflareCtx } from '@/lib/storage/d1Client';

export async function isAdminAuthorized(request, payloadAdminId = null) {
    // 1. 优先尝试 Session Token (从 D1 获取)
    const sessionToken = request.headers.get('x-admin-session');
    if (sessionToken) {
        const session = await queryOne(
            'SELECT 1 FROM admin_sessions WHERE token = ? AND expires_at > ?',
            [sessionToken, Date.now()]
        );
        if (session) return true;
    }

    // 2. 后备方案：长期 PSK (用于 CRON 或特殊场景)
    const adminKey = request.headers.get('x-admin-key');

    // 获取环境变量密钥：先查 process.env，再查 Cloudflare context
    let envKey = process.env.ADMIN_API_KEY;
    if (!envKey) {
        try {
            const ctx = await getCloudflareCtx();
            envKey = ctx?.env?.ADMIN_API_KEY;
        } catch (e) {
            console.error('[Auth] Fail to get env from context:', e.message);
        }
    }

    if (!envKey) {
        console.warn('ADMIN_API_KEY is not configured on server.');
        return false;
    }

    // 如果是通过 Query 参数发送的也可以支持 (调试用)
    const queryKey = new URL(request.url).searchParams.get('token');

    return adminKey === envKey || queryKey === envKey;
}
