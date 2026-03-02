const fetch = require('node-fetch');

async function test() {
    const code = '110011';
    const days = 250;
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${days}&_=${Date.now()}`;

    try {
        const res = await fetch(url, { headers: { 'Referer': `http://fundf10.eastmoney.com/jjjz_${code}.html`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
        const text = await res.text();
        console.log('Body:', text.substring(0, 200));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
