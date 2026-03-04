async function fetchStockHistoryTencent(code, days) {
    try {
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${code.toLowerCase()},day,2024-01-01,2026-12-31,500,qfq`;
        const res = await fetch(url);
        if (res.ok) {
            const text = await res.text();
            console.log('Text start:', text.slice(0, 100));
            const jsonStr = text.replace(/^kline_dayqfq=/, '');
            const d = JSON.parse(jsonStr);
            const stockData = d.data?.[code.toLowerCase()];
            const kline = stockData?.qfqday || stockData?.day;
            if (kline && Array.isArray(kline)) {
                return kline.map(item => ({
                    date: item[0],
                    value: parseFloat(item[2])
                })).filter(i => !isNaN(i.value)).slice(-days);
            } else {
                console.log('No kline found in data');
            }
        } else {
            console.log('Res not ok:', res.status);
        }
    } catch (e) {
        console.warn(`Tencent stock ${code} failed:`, e.message);
    }
    return null;
}

fetchStockHistoryTencent('sh600022', 5).then(res => console.log('Result:', res));
