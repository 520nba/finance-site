import { NextResponse } from 'next/server';
import { getRequestContext } from "@opennextjs/cloudflare";

export const runtime = 'edge';

export async function GET() {
    let debugInfo = {
        status: 'init',
        timestamp: new Date().toISOString()
    };

    try {
        const context = getRequestContext();
        debugInfo.hasContext = !!context;
        debugInfo.hasEnv = !!context?.env;

        if (context?.env) {
            debugInfo.envKeys = Object.keys(context.env);
            debugInfo.hasKV = !!context.env.STOCK_DATA;
            debugInfo.kvType = typeof context.env.STOCK_DATA;
        }

        // 尝试读取一个测试键
        if (context?.env?.STOCK_DATA) {
            try {
                const testVal = await context.env.STOCK_DATA.get('users_config');
                debugInfo.readTest = !!testVal;
                debugInfo.readTestLength = testVal?.length || 0;
            } catch (e) {
                debugInfo.readError = e.message;
            }
        }

        debugInfo.status = 'success';
        return NextResponse.json(debugInfo);
    } catch (e) {
        return NextResponse.json({
            status: 'error',
            error: e.message,
            stack: e.stack,
            partialInfo: debugInfo
        }, { status: 200 }); // 返回 200 以防 Next.js 拦截 500
    }
}
