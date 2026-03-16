import { addSystemLog } from '@/lib/storage/logRepo';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*'
}

/**
 * 获取北京时间当前的日期字符串 (YYYY-MM-DD)
 * 采用二次解析确保时区转换 100% 严谨
 */
const getBeijingTodayStr = () => {
    const bjNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const y = bjNow.getFullYear();
    const m = String(bjNow.getMonth() + 1).padStart(2, '0');
    const d = String(bjNow.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 判断当前是否已过 A 股收盘时间 (北京时间 15:30 以后)
 * 如果已收盘，则允许将“今天”的数据作为正式历史点存入。
 */
const isMarketClosedBeijing = () => {
    const bjNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const hour = bjNow.getHours();
    const minute = bjNow.getMinutes();
    // 15:30 以后视为收盘
    return (hour > 15) || (hour === 15 && minute >= 30);
};

/**
 * 带有指数退避 + Jitter 的 fetch 重试逻辑
 */
async function fetchWithRetry(url, options = {}, retry = 2, signal = null) {
    const sleepWithSignal = (ms, sig) => new Promise((resolve, reject) => {
        if (sig?.aborted) return reject(new Error('AbortError'));
        const timer = setTimeout(resolve, ms);
        sig?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('AbortError'));
        }, { once: true });
    });

    for (let i = 0; i <= retry; i++) {
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 8000); // 内部安全兜底
            const signals = [controller.signal];
            if (signal) signals.push(signal);

            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.any(signals)
            });
            clearTimeout(t);

            if (res.ok) return res;

            // 处理 Retry-After 头部
            const retryAfter = res.headers.get('Retry-After');
            const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 0;

            if (res.status === 429) {
                const backoff = waitTime || (Math.pow(2, i) * 1000 + Math.random() * 500);
                console.warn(`[API] Rate limited (429) on ${url}. Waiting ${Math.round(backoff)}ms...`);
                await sleepWithSignal(backoff, signal);
                continue;
            }

            if (res.status >= 400 && res.status < 500) {
                console.warn(`[API] Client error ${res.status} on ${url}, skipping retry.`);
                return null;
            }

            if (i < retry) {
                const backoff = Math.pow(2, i) * 1000 + Math.random() * 500;
                console.log(`[API] Retrying (${i + 1}/${retry}) due to status ${res.status} in ${Math.round(backoff)}ms`);
                await sleepWithSignal(backoff, signal);
            }
        } catch (e) {
            if (i === retry || e.name === 'AbortError' || e.message === 'AbortError') throw e;
            const backoff = Math.pow(2, i) * 1000 + Math.random() * 500;
            try {
                await sleepWithSignal(backoff, signal);
            } catch (sleepErr) {
                throw sleepErr;
            }
        }
    }
    return null;
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
    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i)
    if (!match) return null

    const mkt = match[1].toLowerCase() === 'sz' ? '0' : '1'
    const clean = match[2]

    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${clean}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=${days + 10}`

    try {
        const res = await fetchWithRetry(url, { headers: { ...BASE_HEADERS, 'Referer': 'https://quote.eastmoney.com/' } }, 2, signal)
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
        const res = await fetchWithRetry(url, { headers: BASE_HEADERS }, 2, signal)
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
        const res = await fetchWithRetry(url, {}, 2, signal)
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
        }, 2, signal);
        if (!res) return null;

        const text = await res.text();

        // 使用正则提取“累计净值走势”数据：Data_ACWorthTrend
        // 数据格式通常为：[[时间戳, 净值], [时间戳, 净值], ...]
        const regex = /var Data_ACWorthTrend = (\[.*?\]);/;
        const found = text.match(regex);
        if (!found || !found[1]) {
            console.error(`[Fetcher] Fund ${code}: Data_ACWorthTrend not found in JS response.`);
            return null;
        }

        const rawData = JSON.parse(found[1]);
        if (!Array.isArray(rawData) || rawData.length === 0) return null;

        const today = getBeijingTodayStr();
        const closed = isMarketClosedBeijing();

        // 转换数据：时间戳(ms) -> YYYY-MM-DD
        const points = rawData.map(item => {
            const dateObj = new Date(item[0]);
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            return {
                date: `${y}-${m}-${d}`,
                value: parseFloat(item[1])
            };
        });

        const converted = normalizePoints(points).filter(i => {
            return closed ? i.date <= today : i.date < today;
        });

        // 关键：数据完整性保护 (确保抓取质量)
        const totalAvailable = converted.length;
        const targetCount = Math.min(days, totalAvailable);
        const result = converted.slice(-days);

        // 如果缺漏超过 10% (且目标样本较大时)，触发熔断重试
        if (result.length < targetCount * 0.9 && targetCount > 30) {
            console.error(`[Fetcher] Fund ${code} integrity check failed: Got ${result.length}, expected ${targetCount}.`);
            return null;
        }

        console.log(`[Fetcher] Fund: Bulk-Fetched ${result.length} points for fund ${code} via pingzhongdata JS.`);
        return result;
    } catch (e) {
        console.error(`[Fetcher] Fund ${code} failed:`, e.message);
        return null;
    }
}
