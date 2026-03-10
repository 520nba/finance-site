import { addSystemLog } from '@/lib/storage/logRepo';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*'
}

const getBeijingTodayStr = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function fetchWithRetry(url, options = {}, retry = 2) {
    for (let i = 0; i <= retry; i++) {
        try {
            const controller = new AbortController()
            const t = setTimeout(() => controller.abort(), 8000)
            const res = await fetch(url, {
                ...options,
                signal: controller.signal
            })
            clearTimeout(t)
            if (res.ok) return res
        } catch (e) {
            if (i === retry) throw e
        }
    }
    return null
}

export async function fetchStockEastmoney(code, days) {
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i)
    if (!match) return null

    const mkt = match[1].toLowerCase() === 'sz' ? '0' : '1'
    const clean = match[2]

    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 10}`

    try {
        const res = await fetchWithRetry(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://quote.eastmoney.com/' } })
        if (!res) return null
        const d = await res.json()
        if (!d?.data?.klines) return null

        const today = getBeijingTodayStr();
        const data = d.data.klines
            .map(line => {
                const p = line.split(',')
                return { date: p[0], value: parseFloat(p[1]) }
            })
            .filter(i => !isNaN(i.value) && i.date < today)

        if (data.length > 0) {
            return data.slice(-days);
        }
        return null
    } catch (e) {
        return null
    }
}

export async function fetchStockTencent(code, days) {
    try {
        const year = new Date().getFullYear() + 2
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${code.toLowerCase()},day,2020-01-01,${year}-12-31,500,qfq`
        const res = await fetchWithRetry(url, { headers: BASE_HEADERS })
        if (!res) return null
        const text = await res.text()
        const jsonStr = text.replace(/^kline_dayqfq=/, '')
        const d = JSON.parse(jsonStr)
        const stockData = d.data?.[code.toLowerCase()]
        const kline = stockData?.qfqday || stockData?.day

        const today = getBeijingTodayStr();
        if (kline && Array.isArray(kline)) {
            return kline
                .map(item => ({
                    date: item[0],
                    value: parseFloat(item[2])
                }))
                .filter(i => !isNaN(i.value) && i.date < today)
                .slice(-days)
        }
        return null
    } catch (e) {
        return null
    }
}

export async function fetchStockSina(code, days) {
    try {
        const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${days}`
        const res = await fetchWithRetry(url)
        if (!res) return null
        const d = await res.json()
        if (!Array.isArray(d)) return null

        const today = getBeijingTodayStr();
        const data = d.map(i => ({
            date: i.day,
            value: parseFloat(i.close)
        })).filter(i => !isNaN(i.value) && i.date < today)

        if (data.length > 0) {
            return data;
        }
        return null
    } catch (e) {
        return null
    }
}

export async function fetchStockHistory(code, days) {
    const res = (await fetchStockEastmoney(code, days)) ||
        (await fetchStockTencent(code, days)) ||
        (await fetchStockSina(code, days));
    if (res) {
        await addSystemLog('INFO', 'ExternalAPI', `Fetched ${res.length} points for stock ${code}`);
    }
    return res;
}

export async function fetchFundHistory(code, days) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i)
    const clean = match ? match[2] : code
    try {
        const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${clean}&pageIndex=1&pageSize=200&_=${Date.now()}`
        const res = await fetchWithRetry(url, {
            headers: {
                ...BASE_HEADERS,
                Referer: 'http://fundf10.eastmoney.com/'
            }
        })
        if (!res) return null
        const d = await res.json()
        const list = d?.Data?.LSJZList || []

        if (list.length > 0) {
            const data = list
                .map(i => ({
                    date: i.FSRQ,
                    value: parseFloat(i.DWJZ)
                }))
                .filter(i => !isNaN(i.value))
                .slice(0, days)
                .reverse();
            await addSystemLog('INFO', 'ExternalAPI', `Fund: Fetched ${data.length} points for fund ${code}`);
            return data;
        }
        return null
    } catch (e) {
        return null
    }
}
