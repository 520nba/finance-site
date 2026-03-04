const fetch = require('node-fetch');

async function test() {
    const code = '024423';
    const days = 250;
    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://fundf10.eastmoney.com/'
    };
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${days}&_=${Date.now()}`;

    try {
        const res = await fetch(url, { headers: BASE_HEADERS });
        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body:', text);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
