const https = require('https');

function fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function start() {
    console.log('Fetching asset list for derek...');
    const { assets } = await fetchJson('https://stock-tracker.sony-fans.workers.dev/api/user/assets?userId=derek');
    console.log(`Found ${assets.length} assets.`);

    const chunks = [];
    for (let i = 0; i < assets.length; i += 8) {
        chunks.push(assets.slice(i, i + 8));
    }

    const t0 = Date.now();
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const tChunk = Date.now();
        const data = await fetchJson('https://stock-tracker.sony-fans.workers.dev/api/history/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: chunk.map((a) => ({ code: a.code, type: a.type })) })
        });
        const elap = ((Date.now() - tChunk) / 1000).toFixed(2);
        console.log(`[+${elap}s] Chunk ${i + 1}/${chunks.length} fetched (${Object.keys(data).length} results).`);
    }
    const totalElap = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\n✅ Total time for ALL ${assets.length} history profiles: ${totalElap}s`);
}

start();
