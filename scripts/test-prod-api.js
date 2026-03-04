const https = require('https');

function fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ` + data.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function testCache() {
    console.log('Fetching asset list for derek from PRODUCTION...');
    let assets = [];
    try {
        const userRes = await fetchJson('https://stock-tracker.sony-fans.workers.dev/api/user/assets?userId=derek');
        assets = userRes.assets || [];
        console.log(`✅ Found ${assets.length} assets.`);
    } catch (e) {
        console.error('Failed fetching assets:', e.message);
        return;
    }

    if (assets.length === 0) return;

    // chunk into batches of 4 or 8 like frontend
    const chunks = [];
    for (let i = 0; i < assets.length; i += 8) {
        chunks.push(assets.slice(i, i + 8));
    }

    const t0 = Date.now();

    // Test first chunk to establish KV cache latency
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const tChunk = Date.now();
        console.log(`Requesting Chunk ${i + 1}/${chunks.length} containing ${chunk.length} items...`);
        try {
            const data = await fetchJson('https://stock-tracker.sony-fans.workers.dev/api/history/bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Node-Benchmark/1.0'
                },
                body: JSON.stringify({ items: chunk.map(a => ({ code: a.code, type: a.type })) })
            });
            const elap = ((Date.now() - tChunk) / 1000).toFixed(2);
            console.log(`[+${elap}s] Chunk ${i + 1} fetched. Keys returned: ${Object.keys(data).length}`);
        } catch (e) {
            console.error(`[❌] Chunk ${i + 1} failed:`, e.message);
        }

        // Simulating the 600ms paced fetching from the frontend loop buffer
        await new Promise(r => setTimeout(r, 600));
    }

    const totalElap = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\n🎉 Total elapsed time for ALL ${assets.length} history profiles: ${totalElap}s`);
}

testCache();
