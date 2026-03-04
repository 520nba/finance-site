import { NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request) {
    let secret = process.env.DIAG_SECRET;
    try {
        const ctx = await getCloudflareContext();
        if (ctx?.env?.DIAG_SECRET) secret = ctx.env.DIAG_SECRET;
    } catch (e) { }

    const token = request.headers.get('x-diag-token') || new URL(request.url).searchParams.get('token');

    if (!secret) {
        return NextResponse.json({
            error: 'Unauthorized',
            hint: 'DIAG_SECRET is not configured.'
        }, { status: 403 });
    }

    if (token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let debugInfo = {
        status: 'init',
        timestamp: new Date().toISOString(),
        runtime: typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : 'unknown'
    };

    try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        debugInfo.libraryLoaded = true;

        const ctx = await getCloudflareContext();
        debugInfo.hasContext = !!ctx;
        if (ctx?.env) {
            debugInfo.envKeys = Object.keys(ctx.env);
            debugInfo.hasKV = !!ctx.env.STOCK_DATA;
            debugInfo.hasD1 = !!ctx.env.DB;
        }

        // 备选：检查全局 process.env
        if (typeof process !== 'undefined' && process.env) {
            debugInfo.hasProcessEnv = true;
            debugInfo.processEnvKeys = Object.keys(process.env);
            if (process.env.STOCK_DATA) debugInfo.kvInProcessEnv = true;
        }

        return NextResponse.json(debugInfo);
    } catch (e) {
        // 发生错误时只返回统一提示，坚决不返回 err.stack 以防止信息泄露
        return NextResponse.json({
            status: 'fatal',
            error: 'Internal Server Error'
        }, { status: 500 });
    }
}
