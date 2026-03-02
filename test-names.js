
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/',
};

function resolveMarket(code) {
    const clean = code.replace(/^(sh|sz)/i, '');
    if (code.toLowerCase().startsWith('sh')) return { market: '1', code: clean };
    if (code.toLowerCase().startsWith('sz')) return { market: '0', code: clean };
    const prefix = (clean.startsWith('6') || clean.startsWith('5')) ? '1' : '0';
    return { market: prefix, code: clean };
}

async function fetchStockName(code) {
    const { market, code: clean } = resolveMarket(code);
    try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${clean}&fields=f58`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;
        const json = await res.json();
        return json.data?.f58 || null;
    } catch (e) {
        return null;
    }
}

async function fetchFundName(code) {
    try {
        const url = `https://fundgz.1234567.com.cn/js/${code}.js?_=${Date.now()}`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        if (!res.ok) return null;
        const text = await res.text();
        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) {
            try {
                return JSON.parse(match[1]).name;
            } catch (ee) { }
        }
    } catch (e) { }
    return null;
}

const codes = ['110011', '012348', '600028', '510300', '161716', '024749', '512880'];

(async () => {
    for (const code of codes) {
        const fn = await fetchFundName(code);
        const sn = await fetchStockName(code);
        console.log(`[${code}] Fund: ${fn} | Stock: ${sn}`);
    }
})();
