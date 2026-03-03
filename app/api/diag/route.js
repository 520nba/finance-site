import { NextResponse } from 'next/server';
import * as CF from "@opennextjs/cloudflare";

export const runtime = 'edge';

export async function GET() {
    let debugInfo = {
        status: 'init',
        timestamp: new Date().toISOString(),
        availableExports: Object.keys(CF)
    };

    try {
        // 尝试 getRequestContext
        try {
            const ctx = CF.getRequestContext ? CF.getRequestContext() : null;
            debugInfo.getRequestContextResult = ctx ? 'object' : 'null';
            if (ctx?.env) {
                debugInfo.envKeys = Object.keys(ctx.env);
                debugInfo.hasKV = !!ctx.env.STOCK_DATA;
            }
        } catch (e) {
            debugInfo.getRequestContextError = e.message;
        }

        // 尝试 getCloudflareContext
        try {
            const ctx = CF.getCloudflareContext ? await CF.getCloudflareContext() : null;
            debugInfo.getCloudflareContextResult = ctx ? 'object' : 'null';
            if (ctx?.env && !debugInfo.hasKV) {
                debugInfo.hasKV = !!ctx.env.STOCK_DATA;
                if (debugInfo.hasKV) debugInfo.source = 'getCloudflareContext';
            }
        } catch (e) {
            debugInfo.getCloudflareContextError = e.message;
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
