const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/',
};

async function testFetchFundName(code) {
    console.log(`Testing Fund Name for: ${code}`);

    // Test 1: Tencent
    try {
        const url = `https://qt.gtimg.cn/q=s_jj${code}`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        const arrayBuffer = await res.arrayBuffer();
        const text = new TextDecoder('gbk').decode(arrayBuffer);
        console.log(`Tencent Result: ${text}`);
    } catch (e) {
        console.log(`Tencent Failed: ${e.message}`);
    }

    // Test 2: EastMoney lsjz
    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1&_=${Date.now()}`;
        const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' } });
        const data = await res.json();
        console.log(`EastMoney lsjz Result: ${JSON.stringify(data)}`);
    } catch (e) {
        console.log(`EastMoney lsjz Failed: ${e.message}`);
    }

    // Test 3: HTML Title
    try {
        const url = `https://fund.eastmoney.com/${code}.html`;
        const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Accept': 'text/html' } });
        const html = await res.text();
        const titleMatch = html.match(/<title>([^<(]+)/);
        console.log(`HTML Title Result: ${titleMatch ? titleMatch[1] : 'No Match'}`);
    } catch (e) {
        console.log(`HTML Title Failed: ${e.message}`);
    }
}

testFetchFundName('017811');
