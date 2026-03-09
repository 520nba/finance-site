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
    const queryKey = new URL(request.url).searchParams.get('token');
    const inputKey = adminKey || queryKey;

    // 获取环境变量密钥：先查 process.env，再查 Cloudflare context
    let envKey = process.env.ADMIN_API_KEY;
    let envSource = 'process.env';

    if (!envKey) {
        try {
            const ctx = await getCloudflareCtx();
            envKey = ctx?.env?.ADMIN_API_KEY;
            envSource = 'cloudflare.ctx.env';
        } catch (e) {
            console.error('[Auth] Context access error:', e.message);
        }
    }

    // 诊断日志 (仅输出长度和是否存在，不泄露内容)
    console.log(`[AUTH-CHECK] [Source: ${envSource}] EnvKeyLen: ${envKey?.length || 0}, InputKeyLen: ${inputKey?.length || 0}`);

    if (!envKey) {
        console.warn('[Critical] ADMIN_API_KEY is not configured on server.');
        return false;
    }

    if (!inputKey) return false;

    // 严格比对 (增加 trim 容错性)
    const match = inputKey.trim() === envKey.trim();

    if (!match) {
        console.warn(`[Auth-Mismatch] Path: ${new URL(request.url).pathname}, InputPrefix: ${inputKey.slice(0, 2)}... EnvPrefix: ${envKey.slice(0, 2)}...`);
    }

    return match;
}
