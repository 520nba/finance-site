const https = require('https');

function fetchIntraday(code) {
    const market = code.startsWith('sz') ? '0' : '1';
    const clean = code.replace(/[a-zA-Z]/g, '');
    const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${market}.${clean}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;

    https.get(url, (res) => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
            const json = JSON.parse(raw);
            const trends = json.data.trends || [];
            console.log(`Code: ${code}, Total Trends: ${trends.length}`);
            if (trends.length > 0) {
                console.log(`First point: ${trends[0]}`);
                console.log(`Middle point: ${trends[Math.floor(trends.length / 2)]}`);
                console.log(`Last point: ${trends[trends.length - 1]}`);
            }
        });
    });
}

fetchIntraday('sh600519'); // Maotai
fetchIntraday('sz000001'); // Ping An Bank
fetchIntraday('sh510300'); // 300 ETF
