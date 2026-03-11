
async function fetchEm() {
    // 抓取 60 条，覆盖 1、2、3 月
    const res = await fetch("https://api.fund.eastmoney.com/f10/lsjz?fundCode=003379&pageIndex=1&pageSize=60", {
        headers: {
            "Referer": "http://fundf10.eastmoney.com/",
            "User-Agent": "Mozilla/5.0"
        }
    });
    const data = await res.json();
    const list = data.Data.LSJZList;
    console.log("Date | DWJZ | LJJZ");
    list.forEach(i => {
        console.log(`${i.FSRQ} | ${i.DWJZ} | ${i.LJJZ}`);
    });
}
fetchEm();
