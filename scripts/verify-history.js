async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timeout);
    }
}

async function testStock(code, days) {
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.' + code + '&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=' + (days + 5);
    const start = Date.now();
    try {
        const res = await fetchWithTimeout(url, { headers: { 'Referer': 'https://quote.eastmoney.com/' } }, 4000);
        const d = await res.json();
        if (d.data && d.data.klines) {
            console.log('[Stock]', code, 'request took', Date.now() - start, 'ms. Records fetched:', d.data.klines.length);
            console.log('Sample data (last 2):', d.data.klines.slice(-2));
        } else {
            console.log('[Stock]', code, 'returned no klines data');
        }
    } catch (e) {
        console.error('Stock fetch failed:', e.message);
    }
}

async function testFund(code, days) {
    let start = Date.now();
    try {
        const probeRes = await fetchWithTimeout(
            'https://api.fund.eastmoney.com/f10/lsjz?fundCode=' + code + '&pageIndex=1&pageSize=20&_=' + Date.now(),
            { headers: { 'Referer': 'http://fundf10.eastmoney.com/' } },
            4000
        );
        const probeData = await probeRes.json();
        const totalCount = probeData.TotalCount || 0;
        console.log('[Fund] Probe', code, 'took', Date.now() - start, 'ms. TotalCount available:', totalCount);

        if (totalCount === 0) return;

        const targetCount = Math.min(days, totalCount);
        const pagesNeeded = Math.ceil(targetCount / 20);

        start = Date.now();
        const pagePromises = [];
        for (let page = 2; page <= pagesNeeded; page++) {
            pagePromises.push(
                () => fetchWithTimeout(
                    'https://api.fund.eastmoney.com/f10/lsjz?fundCode=' + code + '&pageIndex=' + page + '&pageSize=20&_=' + Date.now(),
                    { headers: { 'Referer': 'http://fundf10.eastmoney.com/' } },
                    3000
                ).then(r => r.ok ? r.json() : null).catch(() => null)
            );
        }

        const pageResults = [];
        const PAGE_BATCH_SIZE = 6;
        for (let i = 0; i < pagePromises.length; i += PAGE_BATCH_SIZE) {
            const batch = pagePromises.slice(i, i + PAGE_BATCH_SIZE);
            const batchRes = await Promise.all(batch.map(fn => fn()));
            pageResults.push(...batchRes);
        }

        let allDataCount = probeData.Data?.LSJZList?.length || 0;
        for (const res of pageResults) {
            if (res && res.Data && res.Data.LSJZList) {
                allDataCount += res.Data.LSJZList.length;
            }
        }
        console.log('[Fund]', code, 'fetched', pagePromises.length, 'pages in', Date.now() - start, 'ms. Total records collected:', allDataCount);
    } catch (e) {
        console.error('Fund fetch failed:', e.message);
    }
}

async function main() {
    console.log('--- Testing Stock Data Fetch ---');
    await testStock('600519', 250); // 茅台
    console.log('\n--- Testing Fund Data Fetch ---');
    await testFund('110020', 250); // 易方达沪深300
}

main();
