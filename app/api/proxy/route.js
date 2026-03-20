import { NextResponse } from 'next/server';
import { validateProxyTarget } from '@/lib/proxy/validator';
import { proxyFetch } from '@/lib/proxy/fetcher';
import { normalizeProxyResponse } from '@/lib/proxy/normalizer';
import { requireUser } from '@/lib/auth/requireUser';

export async function GET(request) {
    // 0. 认证守卫：防止未登录用户滥用代理消耗 Workers 配额
    const userId = await requireUser(request);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawUrl = new URL(request.url).searchParams.get('url');

    // 1. 安全校验
    const validation = validateProxyTarget(rawUrl);
    if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    try {
        // 2. 网络抓取 (带超时与编码感知)
        const { response, isGbk } = await proxyFetch(validation.urlObj);

        // 3. 非 2xx 透传 (直接原样返回，不做内容处理)
        if (response.status < 200 || response.status >= 300) {
            const text = await response.text();
            console.error(`[Proxy] Upstream ${response.status} for ${rawUrl}`);
            return new NextResponse(text, {
                status: response.status,
                headers: { 'Content-Type': response.headers.get('content-type') || 'text/plain' }
            });
        }

        // 4. 内容归一化 (处理编码转换与 BOM 清理)
        const { text, json, contentType } = await normalizeProxyResponse(response, isGbk);

        // 5. 优先返回解析后的 JSON，否则返回文本
        if (json !== null) {
            return NextResponse.json(json);
        }

        return new NextResponse(text, {
            headers: { 'Content-Type': contentType }
        });

    } catch (error) {
        const isDev = process.env.NODE_ENV !== 'production';
        console.error(`[Proxy] Critical error for ${rawUrl}:`, error.message);
        return NextResponse.json({
            error: isDev ? error.message : 'Internal Proxy Error',
            ...(isDev && { context: 'proxy_catch', url: rawUrl })
        }, { status: 500 });
    }
}
