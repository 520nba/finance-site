
async function testFundBaseInfo(code) {
    try {
        const url = `https://fundmobapi.eastmoney.com/FundMApi/FundBaseInfo.ashx?FCODE=${code}&deviceid=test&plat=Wap&product=EFund&version=2.0.0`;
        const res = await fetch(url);
        const json = await res.json();
        return json.Datas?.SHORTNAME || json.Datas?.FNAME || null;
    } catch (e) {
        console.error(`Error for ${code}: ${e.message}`);
    }
    return null;
}

const codes = ['110011', '012348', '161716', '024749'];
(async () => {
    for (const code of codes) {
        const name = await testFundBaseInfo(code);
        console.log(`[${code}] BaseInfo: ${name}`);
    }
})();
