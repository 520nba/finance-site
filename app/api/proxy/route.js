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
    try { urlObj = new URL(targetUrl); } catch { return NextResponse.json({ error: 'Invalid url' }, { status: 400 }); }
    try {
        const headers = buildHeaders(urlObj);
        const res = await fetch(targetUrl, { headers });
        const contentTypeHeader = res.headers.get('content-type') || 'text/plain';
        const status = res.status;

        // 移除 GBK 解码，全面拥抱东方财富 UTF-8 原生 JSON
        const text = await res.text();

        if (status < 200 || status >= 300) return new NextResponse(text, { status, headers: { 'Content-Type': contentTypeHeader } });
        const cleanText = text.replace(/^\uFEFF/, '').trim();

        if (contentTypeHeader.includes('application/json') || (cleanText.startsWith('{') && cleanText.endsWith('}')) || (cleanText.startsWith('[') && cleanText.endsWith(']'))) {
            try { return NextResponse.json(JSON.parse(cleanText)); } catch { }
        }
        return new NextResponse(text, { headers: { 'Content-Type': contentTypeHeader } });
    } catch (error) {
        return NextResponse.json({
            error: error.message,
            stack: error.stack,
            context: 'proxy_catch'
        }, { status: 500 });
    }
}
