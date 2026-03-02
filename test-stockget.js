
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*', 'Referer': 'https://quote.eastmoney.com/',
};

async function testStockGet(secid) {
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f58`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        const json = await res.json();
        return json.data?.f58 || null;
    } catch (e) { }
    return null;
}

const codes = ['0.012348', '1.600028', '0.000001', '1.510300', '0.110011', '1.110011'];
(async () => {
    for (const sid of codes) {
        const name = await testStockGet(sid);
        console.log(`${sid}: ${name}`);
    }
})();
