export async function GET() {
    // 说明：这里曾经探测过 env.STOCK_DATA（KV）。该 KV 命名空间实测为空、
    // 且代码里已无任何引用，已连同 wrangler.toml 的绑定一并清理，故不再探测。
    return new Response(JSON.stringify({
        ok: true,
        time: new Date().toISOString(),
        env: {
            NEXT_RUNTIME: typeof process !== 'undefined' ? process.env.NEXT_RUNTIME : 'undefined',
        }
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
