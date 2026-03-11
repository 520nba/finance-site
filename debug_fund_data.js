
async function check() {
    const res = await fetch("https://api.fund.eastmoney.com/f10/lsjz?fundCode=003379&pageIndex=1&pageSize=50", {
        headers: { "Referer": "http://fundf10.eastmoney.com/" }
    });
    const data = await res.json();
    const list = data.Data.LSJZList;
    console.log("Date | DWJZ | LJJZ");
    list.filter(i => i.FSRQ.startsWith('2026-02') || i.FSRQ.startsWith('2026-01')).forEach(i => {
        console.log(`${i.FSRQ} | ${i.DWJZ} | ${i.LJJZ}`);
    });
}
check();
