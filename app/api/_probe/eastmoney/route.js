/**
 * 临时诊断路由（实验用，测完即删）
 *
 * 目的：切开「出口池」与「运行时包装」这两个变量 ——
 * 同一个东财 push2 URL，在应用 Worker 内分别用：
 *   native           原生 fetch（等价于 /api/proxy 的调用方式）
 *   resolve-CN       强制解析到国内 CDN IP（本机解析到的 61.129.129.196）
 *   resolve-CN2      另一个国内解析（14.103.191.91）
 *   no-store         cache: no-store
 * 观察是否只有某一种能拿到 rc:0。
 *
 * 安全：需要登录态（requireUser），不作为公开接口。
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/requireUser';
import { EASTMONEY_HEADERS } from '@/lib/constants/headers';

export const dynamic = 'force-dynamic';

const TARGET = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58';

const MODES = [
    { name: 'native', opts: {} },
    { name: 'resolve-CN', opts: { cf: { resolveOverride: '61.129.129.196' } } },
    { name: 'resolve-CN2', opts: { cf: { resolveOverride: '14.103.191.91' } } },
    { name: 'no-store', opts: { cache: 'no-store' } }
];

export async function GET(request) {
    const userId = await requireUser(request);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = [];

    for (const m of MODES) {
        const started = Date.now();
        try {
            const res = await fetch(TARGET, {
                headers: EASTMONEY_HEADERS,
                ...m.opts
            });
            const body = await res.text();
            results.push({
                mode: m.name,
                status: res.status,
                ms: Date.now() - started,
                cacheStatus: res.headers.get('cf-cache-status'),
                body: body.slice(0, 160)
            });
        } catch (e) {
            results.push({ mode: m.name, ms: Date.now() - started, error: String((e && e.message) || e) });
        }
    }

    return NextResponse.json({ target: TARGET, results });
}
