
async function fetchEm() {
    const res = await fetch("https://api.fund.eastmoney.com/f10/lsjz?fundCode=002920&pageIndex=1&pageSize=20", {
        headers: { "Referer": "http://fundf10.eastmoney.com/" }
    });
    const data = await res.json();
    console.log("TotalCount:", data.TotalCount || data.Data?.TotalCount);
}
fetchEm();
