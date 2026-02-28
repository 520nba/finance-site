export const runtime = 'edge';

export async function GET() {
    return new Response(JSON.stringify({
        ok: true,
        time: new Date().toISOString(),
        env: {
            NEXT_RUNTIME: typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : 'undefined',
            HAS_STOCK_KV: typeof STOCK_KV !== 'undefined',
        }
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
