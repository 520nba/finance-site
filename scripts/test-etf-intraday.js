const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
};

function resolveMarket(code) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i);
    let prefix = '';
    let clean = code;
    let market = '1';
    if (match) {
        prefix = match[1].toLowerCase();
        clean = match[2];
        if (prefix === 'sz') market = '0';
    }
    return { market, clean };
}

async function test(code) {
    const { market, clean } = resolveMarket(code);
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${market}.${clean}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
    const res = await fetch(url, { headers: BASE_HEADERS });
    const json = await res.json();
    const d = json.data;
    if (!d || !d.trends || !Array.isArray(d.trends) || d.trends.length === 0) {
        console.log("No trends data");
        return;
    }
    let points = [];
    let prePrice = parseFloat(d.preClose) || parseFloat(d.prePrice) || 0;

    points = d.trends.map(line => {
        const parts = line.split(',');
        const fullTime = parts[0];
        const timePart = fullTime.includes(' ') ? fullTime.split(' ')[1] : fullTime;
        const val = parseFloat(parts[2]);
        return {
            time: timePart,
            value: isNaN(val) ? 0 : val
        };
    }).filter(p => p.value > 0);

    console.log(`prePrice: ${prePrice}`);
    console.log(`points count: ${points.length}`);
    console.log(`first price:`, points[0]);
    console.log(`last price:`, points[points.length - 1]);
}

test('sh510880').catch(console.error);
test('sh600028').catch(console.error);
