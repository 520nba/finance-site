
async function debug() {
    const code = '002920';
    const ts = Date.now();
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=20&_=${ts}`;
    const res = await fetch(url, { headers: { 'Referer': 'http://fundf10.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}
debug();
