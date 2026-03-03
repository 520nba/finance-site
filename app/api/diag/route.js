import { NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = 'edge';

export async function GET() {
    try {
        const context = await getCloudflareContext();
        const hasKV = !!context?.env?.STOCK_DATA;
        const envKeys = context?.env ? Object.keys(context.env) : [];

        return NextResponse.json({
            status: 'ok',
            hasKV,
            envKeys,
            runtime: typeof EdgeRuntime !== 'undefined' ? 'edge' : 'node',
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        return NextResponse.json({
            status: 'error',
            message: e.message,
            stack: e.stack
        }, { status: 500 });
    }
}
