import { NextResponse } from 'next/server';

// 按域名注入合适的 Referer
function buildHeaders(urlObj) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
    };
    const host = urlObj.hostname;
    if (host.includes('push2his.eastmoney.com')) {
        // secid 格式: "1.600000" 或 "0.000001"，转换为 sh600000 / sz000001
        const secid = urlObj.searchParams.get('secid') || '';
        const [market, code] = secid.split('.');
        const prefix = market === '1' ? 'sh' : 'sz';
        const stockPath = code ? `${prefix}${code}` : 'sz000001';
        headers['Host'] = 'push2his.eastmoney.com';
        headers['Referer'] = `https://quote.eastmoney.com/${stockPath}.html`;
    } else if (host.includes('api.fund.eastmoney.com')) {
        const fundCode = urlObj.searchParams.get('fundCode') || '000001';
        headers['Referer'] = `https://fundf10.eastmoney.com/jjjz_${fundCode}.html`;
    } else if (host.includes('eastmoney.com')) {
        headers['Referer'] = 'https://fund.eastmoney.com/';
    } else if (host.includes('gtimg.cn')) {
        headers['Referer'] = 'https://finance.qq.com/';
    } else if (host.includes('sina.com.cn') || host.includes('1234567.com.cn')) {
        headers['Referer'] = 'https://finance.sina.com.cn/';
    }
    return headers;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    let urlObj;
    try {
        urlObj = new URL(targetUrl);
    } catch {
        return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 });
    }

    try {
        const headers = buildHeaders(urlObj);
        const needsGbk = urlObj.hostname.includes('gtimg.cn') || urlObj.hostname.includes('sina.com.cn');

        // 所有域名均直连，不使用系统代理
        const res = await fetch(targetUrl, { headers });
        const contentTypeHeader = res.headers.get('content-type') || 'text/plain';
        const buffer = Buffer.from(await res.arrayBuffer());
        const status = res.status;

        const text = needsGbk
            ? new TextDecoder('gbk').decode(buffer)
            : buffer.toString('utf-8');

        if (status < 200 || status >= 300) {
            console.warn(`[Proxy] ${status} for ${targetUrl} | Body: ${text.substring(0, 100)}`);
            return new NextResponse(text, { status, headers: { 'Content-Type': contentTypeHeader } });
        }

        // 智能解析：BOM 清洗 + JSON 探测
        const cleanText = text.replace(/^\uFEFF/, '').trim();
        if (
            contentTypeHeader.includes('application/json') ||
            (cleanText.startsWith('{') && cleanText.endsWith('}')) ||
            (cleanText.startsWith('[') && cleanText.endsWith(']'))
        ) {
            try {
                return NextResponse.json(JSON.parse(cleanText));
            } catch {
                // 不是合法 JSON，降级为纯文本
            }
        }

        return new NextResponse(text, { headers: { 'Content-Type': contentTypeHeader } });
    } catch (error) {
        console.error(`[Proxy Error] ${targetUrl} | Error:`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
