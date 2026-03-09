import { NextResponse } from 'next/server';
import { getCloudflareCtx } from '@/lib/storage/d1Client';

export async function GET() {
    let envKey = process.env.ADMIN_API_KEY;
    let source = 'process.env';

    if (!envKey) {
        try {
            const ctx = await getCloudflareCtx();
            envKey = ctx?.env?.ADMIN_API_KEY;
            source = 'cloudflare.context';
        } catch (e) {
            source = 'error: ' + e.message;
        }
    }

    return NextResponse.json({
        configured: !!envKey,
        source: source,
        keyLength: envKey ? envKey.length : 0,
        // D1 Check
        d1Configured: !!(await getCloudflareCtx())?.env?.DB
    });
}
