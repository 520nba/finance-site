
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
};

async function fetchRawFundHistory(code) {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=10&_=${Date.now()}`;
    const res = await fetch(url, { headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' } });
    if (res.ok) {
        const d = await res.json();
        const list = d.Data?.LSJZList || [];
        return list.map(item => ({ date: item.FSRQ, value: item.DWJZ }));
    }
    return null;
}

async function main() {
    const codes = ['001316', '002301', '003030'];
    console.log('Testing Fund codes for 2026-03-05 data...');
    for (const code of codes) {
        const history = await fetchRawFundHistory(code);
        if (history) {
            console.log(`\nFund: ${code}`);
            console.log(history.slice(0, 3));
        }
    }
}

main();
