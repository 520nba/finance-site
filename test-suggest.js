
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/',
};

async function testFundSuggest(code) {
    try {
        const url = `https://fundsuggest.eastmoney.com/FundSearch/S_Suggest?query=${code}`;
        const res = await fetch(url, { headers: BASE_HEADERS });
        const json = await res.json();
        if (json.Datas && json.Datas.length > 0) {
            return json.Datas[0].NAME;
        }
    } catch (e) {
        console.error(`Error for ${code}: ${e.message}`);
    }
    return null;
}

const codes = ['110011', '012348', '510300', '161716', '024749', '512880'];
(async () => {
    for (const code of codes) {
        const name = await testFundSuggest(code);
        console.log(`[${code}] Suggest: ${name}`);
    }
})();
