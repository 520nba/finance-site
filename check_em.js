
async function fetchEm() {
    const res = await fetch("https://api.fund.eastmoney.com/f10/lsjz?fundCode=003379&pageIndex=1&pageSize=40", { headers: { "Referer": "http://fundf10.eastmoney.com/" } });
    const data = await res.json();
    console.log(data.Data.LSJZList.slice(0, 30).map(i => `${i.FSRQ} | DWJZ: ${i.DWJZ} | LJJZ: ${i.LJJZ}`).join('\n'));
}
fetchEm();
