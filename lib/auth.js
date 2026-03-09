import { queryOne, getCloudflareCtx } from '@/lib/storage/d1Client';

export async function isAdminAuthorized(request, payloadAdminId = null) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    // 1. 优先尝试 Session Token (从 D1 获取)
    const sessionToken = request.headers.get('x-admin-session') || searchParams.get('sess');
    if (sessionToken) {
        const session = await queryOne(
            'SELECT 1 FROM admin_sessions WHERE token = ? AND expires_at > ?',
            [sessionToken, Date.now()]
        );
        if (session) return true;
    }

    // 2. 后备方案：长期 PSK (URL 参数 + Header 双重支持)
    const adminKey = request.headers.get('x-admin-key');
    const queryKey = searchParams.get('token') || searchParams.get('adminKey') || searchParams.get('key');
    const inputKey = adminKey || queryKey;

    // 获取环境变量密钥
    let envKey = process.env.ADMIN_API_KEY;
    if (!envKey) {
        try {
            const ctx = await getCloudflareCtx();
            envKey = ctx?.env?.ADMIN_API_KEY;
        } catch (e) { }
    }

    if (!envKey || !inputKey) {
        return false;
    }

    // 严格 trim 并对比 (兼容输入污染)
    return inputKey.trim() === envKey.trim();
}
