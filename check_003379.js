
async function check() {
    const code = '003379';
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=250&_=${Date.now()}`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'http://fundf10.eastmoney.com/'
        }
    });
    const data = await res.json();
    const list = data.Data.LSJZList;

    console.log(`Total items: ${list.length}`);
    let maxChange = 0;
    let maxChangeDate = '';

    for (let i = 0; i < list.length - 1; i++) {
        const curr = parseFloat(list[i].LJJZ);
        const next = parseFloat(list[i + 1].LJJZ);
        const diff = Math.abs((curr - next) / next * 100);
        if (diff > maxChange) {
            maxChange = diff;
            maxChangeDate = list[i].FSRQ;
        }
    }

    console.log(`Max daily change: ${maxChange.toFixed(2)}% on ${maxChangeDate}`);
    console.log("Latest 5 records:");
    list.slice(0, 5).forEach(i => console.log(`${i.FSRQ}: ${i.DWJZ} (NAV) / ${i.LJJZ} (ACC)`));
}

check();
