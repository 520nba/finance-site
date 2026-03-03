import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
    let debugInfo = {
        status: 'init',
        timestamp: new Date().toISOString()
    };

    try {
        // 动态导入，避免顶层导入失败
        let CF;
        try {
            CF = await import("@opennextjs/cloudflare");
            debugInfo.libraryLoaded = true;
        } catch (e) {
            debugInfo.libraryError = e.message;
        }

        if (CF?.getCloudflareContext) {
            const ctx = await CF.getCloudflareContext();
            debugInfo.hasContext = !!ctx;
            if (ctx?.env) {
                debugInfo.envKeys = Object.keys(ctx.env);
                debugInfo.hasKV = !!ctx.env.STOCK_DATA;
            }
        }

        // 备选：检查全局 process.env
        if (typeof process !== 'undefined' && process.env) {
            debugInfo.hasProcessEnv = true;
            debugInfo.processEnvKeys = Object.keys(process.env);
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
