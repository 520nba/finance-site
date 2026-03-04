const stocks = ['sh600519', 'sz000858']; // 茅台, 五粮液
const q_params = stocks.join(',');
const url = `https://qt.gtimg.cn/q=${q_params}`;

async function test() {
    console.log("Fetching:", url);
    const res = await fetch(url, { headers: { 'Referer': 'https://gu.qq.com/' } });
    if (!res.ok) {
        console.error("Fetch failed");
        return;
    }
    const arrayBuffer = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(arrayBuffer);
    console.log("Result text:", text.slice(0, 150) + "...");
}

test();
