
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function testFetch() {
    const code = '003547';
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=300&_=${Date.now()}`;
    console.log("Fetching:", url);
    const res = await fetch(url, {
        headers: {
            ...BASE_HEADERS,
            Referer: 'http://fundf10.eastmoney.com/'
        }
    });
    const d = await res.json();
    console.log("Status:", d?.ErrCode);
    console.log("Total Count:", d?.TotalCount);
    console.log("List Length:", d?.Data?.LSJZList?.length);
}

testFetch();
