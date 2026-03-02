
const fetch = require('node-fetch'); // Not available in Node.js by default without installation, but maybe user has it.
// Actually, let's use the built-in fetch if it's Node.js 18+.

async function test() {
    const code = '024423';
    const days = 250;
    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://quote.eastmoney.com/',
    };
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${days}&_=${Date.now()}`;

    try {
        const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': `https://fundf10.eastmoney.com/jjjz_${code}.html` } });
        console.log('Status:', res.status);
        const json = await res.json();
        console.log('TotalCount:', json.Data?.TotalCount);
        console.log('ListLength:', json.Data?.LSJZList?.length);
        if (json.Data?.LSJZList?.length > 0) {
            console.log('First Item:', json.Data.LSJZList[0]);
            console.log('Last Item:', json.Data.LSJZList[json.Data.LSJZList.length - 1]);
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
