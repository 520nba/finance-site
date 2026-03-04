import { NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request) {
    const url = new URL(request.url);
    const token = (request.headers.get('x-diag-token') || url.searchParams.get('token'))?.trim();

    let secret;
    const envKeys = [];
    try {
        const ctx = await getCloudflareContext();
        if (ctx?.env) envKeys.push(...Object.keys(ctx.env));
        if (ctx?.env?.DIAG_SECRET) secret = ctx.env.DIAG_SECRET;
    } catch (e) { }

    if (typeof process !== 'undefined' && process.env) {
        envKeys.push(...Object.keys(process.env).filter(k => !envKeys.includes(k)));
        if (!secret) secret = process.env.DIAG_SECRET;
    }

    const cleanSecret = secret?.trim();

    if (!cleanSecret) {
        return NextResponse.json({
            error: 'Unauthorized',
            hint: 'DIAG_SECRET is not configured.',
            envKeys: envKeys
        }, { status: 403 });
    }

    if (token !== cleanSecret) {
        return NextResponse.json({
            error: 'Unauthorized',
            debug: {
                secretLength: cleanSecret.length,
                envKeys: envKeys
            }
        }, { status: 403 });
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
