/**
 * 临时诊断路由（实验用，测完即删）
 *
 * 三种模式，用来把「URL 构造」「proxyFetch 实现」「路由执行环境」三者切开：
 *   native    硬编码 URL + 原生 fetch（已证 rc:0）
 *   raw-u     用 ?u= 传入的 URL + 原生 fetch（检验 URL 构造是否有差异）
 *   proxyfn   用 ?u= 传入的 URL，走应用真正的 validateProxyTarget + proxyFetch（检验代理实现）
 *
 * 返回里带上实际请求的 URL，便于逐字比对。
 * 安全：需要登录态（requireUser）。
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/requireUser';
import { EASTMONEY_HEADERS } from '@/lib/constants/headers';
import { validateProxyTarget } from '@/lib/proxy/validator';
import { proxyFetch } from '@/lib/proxy/fetcher';

export const dynamic = 'force-dynamic';

const HARDCODED = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58';

export async function GET(request) {
    const userId = await requireUser(request);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sp = new URL(request.url).searchParams;
    const u = sp.get('u') || HARDCODED;
    const mode = sp.get('mode') || 'raw-u';

    const out = { mode, inputUrl: u };

    if (mode === 'native' || mode === 'raw-u') {
        const url = mode === 'native' ? HARDCODED : u;
        out.actualUrl = url;
        out.hrefEqualsHardcoded = url === HARDCODED;
        const t = Date.now();
        try {
            const res = await fetch(url, { headers: EASTMONEY_HEADERS });
            const body = await res.text();
            out.status = res.status;
            out.ms = Date.now() - t;
            out.body = body.slice(0, 200);
        } catch (e) {
            out.error = String((e && e.message) || e);
        }
        return NextResponse.json(out);
    }

    // proxyfn：与应用 /api/proxy 完全一致的调用链
    const v = validateProxyTarget(u);
    if (!v.ok) {
        return NextResponse.json({ ...out, error: `validate failed: ${v.error}` }, { status: 400 });
    }
    out.actualUrl = v.urlObj.href;
    out.hrefEqualsInput = v.urlObj.href === u;

    const t = Date.now();
    try {
        const { response } = await proxyFetch(v.urlObj);
        const body = await response.text();
        out.status = response.status;
        out.ms = Date.now() - t;
        out.body = body.slice(0, 200);
    } catch (e) {
        out.error = String((e && e.message) || e);
    }
    return NextResponse.json(out);
}
