const fetch = require('node-fetch');

const STOCKS = [
    '600519', '000001', '601318', '600036', '000858',
    '601012', '600900', '601398', '600276', '000333',
    '002594', '601888', '600031', '000002', '601166',
    '600809', '002714', '300750', '601899', '600585'
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timeout);
    }
}

async function testStock(code) {
    for (const mkt of ['1', '0']) {
        try {
            const start = Date.now();
            const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${code}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=255`;
            const res = await fetchWithTimeout(url, { headers: { 'Referer': 'https://quote.eastmoney.com/' } }, 4000);
            const d = await res.json();
            if (d.data && d.data.klines && d.data.klines.length > 0) {
                const elapsed = Date.now() - start;
                const last = d.data.klines[d.data.klines.length - 1];
                console.log(`OK  ${code} | ${d.data.name || '?'} | ${d.data.klines.length} records | ${elapsed}ms | last: ${last}`);
                return true;
            }
        } catch (e) {
            // try next market
        }
    }
    console.log(`FAIL ${code} | no data`);
    return false;
}

async function main() {
    console.log('=== Testing 20 Stocks History ===\n');
    let ok = 0, fail = 0;
    const totalStart = Date.now();
    for (const code of STOCKS) {
        const result = await testStock(code);
        if (result) ok++; else fail++;
    }
    console.log(`\n=== Result: ${ok} OK, ${fail} FAIL, total ${Date.now() - totalStart}ms ===`);
}
main();
