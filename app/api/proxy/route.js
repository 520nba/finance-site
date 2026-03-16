import { NextResponse } from 'next/server';


function buildHeaders(urlObj) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
    };
    const host = urlObj.hostname;
    if (host.includes('eastmoney.com') || host.includes('1234567.com.cn')) {
        headers['Referer'] = 'https://quote.eastmoney.com/';
    }
    return headers;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');
    if (!targetUrl) return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    let urlObj;
    try {
        urlObj = new URL(targetUrl);
    } catch {
        return NextResponse.json({ error: 'Invalid url format' }, { status: 400 });
    }

    // SSRF 基础防御：只允许 http 和 https 协议
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return NextResponse.json({ error: 'Forbidden protocol' }, { status: 403 });
    }

    // 域名白名单保护，防止内网扫描或跳板攻击
    const ALLOWED_DOMAINS = [
        'eastmoney.com',
        '1234567.com.cn',
        'gtimg.cn' // 腾讯财经
    ];

    const isAllowed = ALLOWED_DOMAINS.some(domain =>
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
        return NextResponse.json({ error: 'Forbidden Proxy Target' }, { status: 403 });
    }

    try {
        const headers = buildHeaders(urlObj);
        // 增加信号超时处理，防止 Node.js fetch 无响应挂起
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(targetUrl, {
            headers,
            signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        const contentTypeHeader = res.headers.get('content-type') || 'text/plain';
        const status = res.status;
        if (status >= 300) {
            const errorMsg = `Proxy Status ${status} for ${targetUrl}`;
            console.error(`[Proxy] Error: ${errorMsg}, Type: ${contentTypeHeader}`);
        }

        // 记录响应头，辅助调试
        console.log(`[Proxy] Response status: ${status}, Type: ${contentTypeHeader} for ${targetUrl}`);

        const text = await res.text();

        if (status < 200 || status >= 300) {
            console.error(`[Proxy] Error status ${status}:`, text.slice(0, 200));
            return new NextResponse(text, { status, headers: { 'Content-Type': contentTypeHeader } });
        }

        const cleanText = text.replace(/^\uFEFF/, '').trim();

        if (contentTypeHeader.includes('application/json') || (cleanText.startsWith('{') && cleanText.endsWith('}')) || (cleanText.startsWith('[') && cleanText.endsWith(']'))) {
            try { return NextResponse.json(JSON.parse(cleanText)); } catch { }
        }
        return new NextResponse(text, { headers: { 'Content-Type': contentTypeHeader } });
    } catch (error) {
        console.error(`[Proxy] Critical error for ${targetUrl}:`, error.message);
        return NextResponse.json({
            error: process.env.NODE_ENV === 'production' ? 'Internal Proxy Error' : error.message,
            ...(process.env.NODE_ENV !== 'production' && { context: 'proxy_catch', url: targetUrl })
        }, { status: 500 });
    }
}
