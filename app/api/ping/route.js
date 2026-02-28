import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
    let hasKv = false;
    try {
        const { env } = await getCloudflareContext();
        hasKv = !!env?.STOCK_KV;
    } catch { }

    return new Response(JSON.stringify({
        ok: true,
        time: new Date().toISOString(),
        env: {
            NEXT_RUNTIME: typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : 'undefined',
            HAS_STOCK_KV: hasKv,
        }
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
