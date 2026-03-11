
async function test() {
    const code = '003379';
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=20`;
    const res = await fetch(url, { headers: { 'Referer': 'http://fundf10.eastmoney.com/' } });
    const data = await res.json();
    console.log("Keys in root:", Object.keys(data));
    if (data.Data) console.log("Keys in Data:", Object.keys(data.Data));
    if (data.Data?.LSJZList) console.log("LSJZList length:", data.Data.LSJZList.length);
}
test();
