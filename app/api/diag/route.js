import { NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = 'edge';

export async function GET() {
    let debugInfo = {
        status: 'init',
        timestamp: new Date().toISOString()
    };

    try {
        const ctx = await getCloudflareContext();
        debugInfo.hasContext = !!ctx;
        debugInfo.hasEnv = !!ctx?.env;

        if (ctx?.env) {
            debugInfo.envKeys = Object.keys(ctx.env);
            debugInfo.hasKV = !!ctx.env.STOCK_DATA;
            debugInfo.kvType = typeof ctx.env.STOCK_DATA;
        }

        // 尝试读取一个测试键
        if (ctx?.env?.STOCK_DATA) {
            try {
                // 使用 get 或 list 来测试连通性
                const testVal = await ctx.env.STOCK_DATA.get('users_index');
                debugInfo.readIndex = !!testVal;
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
        });
    }
}
