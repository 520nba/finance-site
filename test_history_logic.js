
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function fetchFundHistory(code, days) {
    const clean = code;
    try {
        const probeUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=100&_=${Date.now()}`;
        console.log("Probing:", probeUrl);
        const probeRes = await fetch(probeUrl, {
            headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' }
        });
        const probeData = await probeRes.json();
        const totalCount = probeData.TotalCount || 0;
        console.log("TotalCount:", totalCount);
        const firstPage = probeData.Data?.LSJZList || [];
        console.log("First page size:", firstPage.length);
        const resultList = [...firstPage];

        const targetCount = Math.min(days, totalCount);
        const pageSize = 100;
        const totalPages = Math.ceil(targetCount / pageSize);
        console.log("Total pages needed:", totalPages);

        for (let page = 2; page <= totalPages; page++) {
            const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=${page}&pageSize=${pageSize}&_=${Date.now()}`;
            console.log("Fetching page:", page, url);
            const res = await fetch(url, {
                headers: { ...BASE_HEADERS, 'Referer': 'http://fundf10.eastmoney.com/' }
            });
            const d = await res.json();
            if (d?.Data?.LSJZList) {
                console.log("Page", page, "size:", d.Data.LSJZList.length);
                resultList.push(...d.Data.LSJZList);
            }
        }
        console.log("Total result list size:", resultList.length);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

fetchFundHistory('003547', 250);
