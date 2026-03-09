import { NextResponse } from 'next/server';
import { getCloudflareCtx } from '@/lib/storage/d1Client';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    let envKey = process.env.ADMIN_API_KEY;
    let envSource = 'process.env';

    let ctxEnvKey = null;
    try {
        const ctx = await getCloudflareCtx();
        ctxEnvKey = ctx?.env?.ADMIN_API_KEY;
    } catch (e) { }

    // 如果 process.env 不对，看看 ctx.env 是不是对的
    const matchProcess = token && envKey && token.trim() === envKey.trim();
    const matchCtx = token && ctxEnvKey && token.trim() === ctxEnvKey.trim();

    return NextResponse.json({
        configured: !!envKey || !!ctxEnvKey,
        source: envSource,
        envKeyLen: envKey?.length || 0,
        ctxEnvKeyLen: ctxEnvKey?.length || 0,
        tokenLen: token?.length || 0,
        matchProcess,
        matchCtx,
        envPrefix: envKey?.slice(0, 3),
        ctxEnvPrefix: ctxEnvKey?.slice(0, 3),
        tokenPrefix: token?.slice(0, 3)
    });
}
