
async function debug() {
    const code = '002920';
    const days = 250;
    const pageSize = 20;
    const ts = Date.now();
    const probeUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${pageSize}&_=${ts}`;
    const probeRes = await fetch(probeUrl, { headers: { 'Referer': 'http://fundf10.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' } });
    const probeData = await probeRes.json();
    const totalCount = probeData?.TotalCount ?? probeData?.Data?.TotalCount ?? 0;
    console.log("TotalCount:", totalCount);

    const targetCount = Math.min(days, totalCount);
    const totalPages = Math.ceil(targetCount / pageSize);
    console.log("TargetCount:", targetCount, "TotalPages:", totalPages);
}
debug();
