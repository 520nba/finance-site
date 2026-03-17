import { fetchWithRetry, getBeijingTodayStr, isMarketClosedBeijing, formatDateInTimezone } from '@/lib/utils';
import { addSystemLog } from '@/lib/storage/logRepo';
import { parseStockCode } from '@/lib/utils/stockCode';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*'
}

/**
 * 统一 Schema 校验与归一化
 */
function normalizePoints(points) {
    if (!Array.isArray(points)) return [];
    return points
        .map(p => ({
            date: String(p.date),
            value: parseFloat(p.value)
        }))
        .filter(p => p.date && !isNaN(p.value) && p.value > 0);
}

export async function fetchStockEastmoney(code, days, signal = null) {
    const parsed = parseStockCode(code);
    if (!parsed) return null;

    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${parsed.market}.${parsed.clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 10}`

    try {
        const res = await fetchWithRetry(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://quote.eastmoney.com/' } }, 0, signal)
        if (!res) return null
        const d = await res.json()
        if (!d?.data?.klines) return null

        const today = getBeijingTodayStr();
        const closed = isMarketClosedBeijing();
        const points = d.data.klines.map(line => {
            const p = line.split(',')
            return { date: p[0], value: parseFloat(p[1]) }
        });

        const data = normalizePoints(points)
            .filter(i => (closed ? i.date <= today : i.date < today))

        if (data.length > 0) {
            return data.slice(-days);
        }
        return null
    } catch (e) {
        return null
    }
}

export async function fetchStockTencent(code, days, signal = null) {
    try {
        const year = new Date().getFullYear() + 2
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${code.toLowerCase()},day,2020-01-01,${year}-12-31,500,qfq`
        const res = await fetchWithRetry(url, { headers: BASE_HEADERS }, 0, signal)
        if (!res) return null
        const text = await res.text()
        const jsonStr = text.replace(/^kline_dayqfq=/, '')
        const d = JSON.parse(jsonStr)
        const stockData = d.data?.[code.toLowerCase()]
        const kline = stockData?.qfqday || stockData?.day

        const today = getBeijingTodayStr();
        const closed = isMarketClosedBeijing();
        if (kline && Array.isArray(kline)) {
            const points = kline.map(item => ({
                date: item[0],
                value: parseFloat(item[2])
            }));

            return normalizePoints(points)
                .filter(i => (closed ? i.date <= today : i.date < today))
                .slice(-days)
        }
        return null
    } catch (e) {
        return null
    }
}

export async function fetchStockSina(code, days, signal = null) {
    try {
        const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${days}`
        const res = await fetchWithRetry(url, {}, 0, signal)
        if (!res) return null
        const d = await res.json()
        if (!Array.isArray(d)) return null

        const today = getBeijingTodayStr();
        const closed = isMarketClosedBeijing();
        const points = d.map(i => ({
            date: i.day.split(' ')[0],
            value: parseFloat(i.close)
        }));

        const data = normalizePoints(points)
            .filter(i => (closed ? i.date <= today : i.date < today))

        if (data.length > 0) {
            return data;
        }
        return null
    } catch (e) {
        return null
    }
}

export async function fetchStockHistory(code, days, signal = null) {
    const res = (await fetchStockEastmoney(code, days, signal)) ||
        (await fetchStockTencent(code, days, signal)) ||
        (await fetchStockSina(code, days, signal));
    if (res) {
        console.log(`[Fetcher] Fetched ${res.length} points for stock ${code}`);
    }
    return res;
}

export async function fetchFundHistory(code, days, signal = null) {
    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i);
    const clean = match ? match[2] : code;

    try {
        // 使用天天基金“一波流”接口：获取全量历史走势 JS
        // 修正为 HTTPS 避免明文请求
        const url = `https://fund.eastmoney.com/pingzhongdata/${clean}.js`;
        const res = await fetchWithRetry(url, {
            headers: { ...BASE_HEADERS, 'Referer': 'https://fund.eastmoney.com/' }
        }, 0, signal);
        if (!res) return null;

        const text = await res.text();

        // 尝试匹配不同的变量名：Data_ACWorthTrend (普通基金) 或 Data_netWorthTrend (FOF)
        const regexAC = /var Data_ACWorthTrend = (\[.*?\]);/;
        const regexNet = /var Data_netWorthTrend = (\[.*?\]);/;

        const matchAC = text.match(regexAC);
        const matchNet = text.match(regexNet);

        const found = matchAC || matchNet;
        if (!found || !found[1]) {
            console.error(`[Fetcher] Fund ${code}: Required data variables not found in JS response.`);
            return null;
        }

        const rawData = JSON.parse(found[1]);
        if (!Array.isArray(rawData) || rawData.length === 0) return null;

        const today = getBeijingTodayStr();
        const closed = isMarketClosedBeijing();

        // 转换数据：识别单点格式 [timestamp, value] 或 {x: timestamp, y: value}
        const points = rawData.map(item => {
            let ts, val;
            if (Array.isArray(item)) {
                [ts, val] = item;
            } else if (item && typeof item === 'object') {
                ts = item.x;
                val = item.y;
            }

            if (ts === undefined || val === undefined) return null;

            return {
                date: formatDateInTimezone(ts, "Asia/Shanghai"),
                value: parseFloat(val)
            };
        }).filter(p => p !== null);

        const converted = normalizePoints(points).filter(i => {
            return closed ? i.date <= today : i.date < today;
        });

        // 关键：数据完整性保护 (确保抓取质量)
        // 逻辑：如果原始数据点很多，但经过解析/过滤后只剩下很少，说明解析逻辑或数据可能异常
        const rawPointCount = rawData.length;
        const result = converted.slice(-days);

        // 期望得到的条数：或者是 days，或者是该基金从诞生至今的总天数
        const expectation = Math.min(days, rawPointCount);

        // 如果解析出来的条数明显少于原始条数（且属于需要审计的大样本），触发熔断
        if (result.length < expectation * 0.9 && expectation > 30) {
            console.error(`[Fetcher] Fund ${code} integrity check failed: Got ${result.length}, expected near ${expectation} (from ${rawPointCount} raw points).`);
            return null;
        }

        console.log(`[Fetcher] Fund: Bulk-Fetched ${result.length} points for fund ${code} via pingzhongdata JS.`);
        return result;
    } catch (e) {
        console.error(`[Fetcher] Fund ${code} failed:`, e.message);
        return null;
    }
}
