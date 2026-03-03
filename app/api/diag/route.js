import { NextResponse } from 'next/server';

export async function GET() {
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
        }

        // 备选：检查全局 process.env
        if (typeof process !== 'undefined' && process.env) {
            debugInfo.hasProcessEnv = true;
            debugInfo.processEnvKeys = Object.keys(process.env);
            if (process.env.STOCK_DATA) debugInfo.kvInProcessEnv = true;
        }

        return NextResponse.json(debugInfo);
    } catch (e) {
        return NextResponse.json({
            status: 'fatal',
            error: e.message,
            stack: e.stack,
            partialInfo: debugInfo
        });
    }
}
