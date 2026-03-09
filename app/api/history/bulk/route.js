import { NextResponse } from 'next/server'
import pLimit from 'p-limit'

import {
    insertDailyPricesBatch,
    getBulkHistory
} from '@/lib/storage/historyRepo'
import { addSystemLog } from '@/lib/storage/logRepo';

/**
 * =============================
 * 基础配置
 * =============================
 */

const LIMIT = pLimit(4)

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*'
}

const HISTORY_DAYS = 250

/**
 * =============================
 * 时间工具
 * =============================
 */

function bjDate() {
    return new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
    )
}

function todayStr() {
    return bjDate().toISOString().slice(0, 10)
}

function daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    const diffTime = date2 - date1;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * =============================
 * fetch 工具
 * =============================
 */

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

/**
 * =============================
 * 股票数据源
 * =============================
 */

async function fetchStockEastmoney(code, days) {
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

        const data = d.data.klines
            .map(line => {
                const p = line.split(',')
                return { date: p[0], value: parseFloat(p[1]) }
            })
            .filter(i => !isNaN(i.value))

        if (data.length > 0) {
            await addSystemLog('INFO', 'ExternalAPI', `EastMoney: Fetched ${data.length} points for stock ${code}`);
            return data.slice(-days);
        }
        return null
    } catch (e) {
        await addSystemLog('WARN', 'ExternalAPI', `EastMoney stock ${code} failed: ${e.message}`);
        return null
    }
}

async function fetchStockTencent(code, days) {
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

        if (kline && Array.isArray(kline)) {
            const count = kline.length;
            await addSystemLog('INFO', 'ExternalAPI', `Tencent: Fetched ${count} points for stock ${code}`);
            return kline
                .map(item => ({
                    date: item[0],
                    value: parseFloat(item[2])
                }))
                .filter(i => !isNaN(i.value))
                .slice(-days)
        }
        return null
    } catch (e) {
        await addSystemLog('ERROR', 'ExternalAPI', `Tencent stock ${code} failed: ${e.message}`);
        return null
    }
}

async function fetchStockSina(code, days) {
    try {
        const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=no&datalen=${days}`
        const res = await fetchWithRetry(url)
        if (!res) return null
        const d = await res.json()
        if (!Array.isArray(d)) return null

        const data = d.map(i => ({
            date: i.day,
            value: parseFloat(i.close)
        }))

        if (data.length > 0) {
            await addSystemLog('INFO', 'ExternalAPI', `Sina: Fetched ${data.length} points for stock ${code}`);
            return data;
        }
        return null
    } catch (e) {
        await addSystemLog('ERROR', 'ExternalAPI', `Sina stock ${code} failed: ${e.message}`);
        return null
    }
}

async function fetchStockHistory(code, days) {
    return (
        (await fetchStockEastmoney(code, days)) ||
        (await fetchStockTencent(code, days)) ||
        (await fetchStockSina(code, days))
    )
}

/**
 * =============================
 * 基金数据
 * =============================
 */

async function fetchFundHistory(code, days) {
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
                .slice(-days)
                .reverse();
            await addSystemLog('INFO', 'ExternalAPI', `EastMoney: Fetched ${data.length} points for fund ${code}`);
            return data;
        }
        return null
    } catch (e) {
        await addSystemLog('ERROR', 'ExternalAPI', `Fund lsjz ${code} failed: ${e.message}`);
        return null
    }
}

/**
 * =============================
 * 统计
 * =============================
 */

function calcStats(history) {
    if (!history || history.length < 2)
        return { perf5d: 0, perf22d: 0, perf250d: 0 }

    const getPerf = days => {
        const data = history.slice(-(days + 1))
        if (data.length < 2 || !data[0].value) return 0
        const first = data[0].value
        const last = data[data.length - 1].value
        const perf = ((last / first - 1) * 100).toFixed(2)
        return Number(perf)
    }

    return {
        perf5d: getPerf(5),
        perf22d: getPerf(22),
        perf250d: getPerf(250)
    }
}

/**
 * =============================
 * 核心同步
 * =============================
 */

export async function syncHistoryBulk(items, days = HISTORY_DAYS) {
    if (!items?.length) return {}
    const result = {}
    const dbHistoryMap = await getBulkHistory(items, days)
    const toFetch = []
    const today = todayStr()

    for (const item of items) {
        const key = `${item.type}:${item.code}`
        const dbHistory = dbHistoryMap[key] || []

        // 获取本地最新日期
        const latestDate = dbHistory.length > 0 ? dbHistory[dbHistory.length - 1].date : null

        if (latestDate) {
            const gap = daysBetween(latestDate, today)
            // 如果最新日期就是今天，或者 gap 极小且已经有足够数据，则跳过
            if (gap <= 0) {
                result[key] = {
                    history: dbHistory,
                    summary: calcStats(dbHistory)
                }
                continue
            }
            // 增量同步：拉取 gap 天的数据（加点 buffer）
            toFetch.push({ ...item, latestDate, daysToFetch: Math.max(gap + 5, 10) })
        } else {
            // 全量同步
            toFetch.push({ ...item, latestDate: null, daysToFetch: days })
        }
    }

    if (toFetch.length === 0) return result

    const fetchedItems = await Promise.all(
        toFetch.map(item =>
            LIMIT(async () => {
                let history = null
                try {
                    if (item.type === 'stock')
                        history = await fetchStockHistory(item.code, item.daysToFetch)
                    else history = await fetchFundHistory(item.code, item.daysToFetch)
                } catch (e) {
                    console.error(`Fetch failed for ${item.code}:`, e.message)
                }
                return { ...item, history }
            })
        )
    )

    const dbRecords = []
    const seen = new Set()

    for (const item of fetchedItems) {
        const key = `${item.type}:${item.code}`
        const dbHistory = dbHistoryMap[key] || []
        const latestDate = item.latestDate

        // 过滤：仅保留日期晚于数据库最新日期的记录
        const newRecords = (item.history || []).filter(h => !latestDate || h.date > latestDate)

        if (newRecords.length > 0) {
            for (const h of newRecords) {
                const k = `${item.code}-${item.type}-${h.date}`
                if (seen.has(k)) continue
                seen.add(k)
                dbRecords.push({
                    code: item.code,
                    type: item.type,
                    price: h.value,
                    date: h.date
                })
            }
        }

        // 合并数据用于计算统计和返回
        const combinedHistory = [...dbHistory, ...newRecords].slice(-days)
        result[key] = {
            history: combinedHistory,
            summary: calcStats(combinedHistory)
        }
    }

    if (dbRecords.length > 0) {
        await insertDailyPricesBatch(dbRecords)
        await addSystemLog('INFO', 'HistorySync', `Incremental Sync: Added ${dbRecords.length} points for ${toFetch.length} assets.`);
    }

    return result
}

/**
 * =============================
 * API
 * =============================
 */

export async function POST(request) {
    try {
        const { items, days = HISTORY_DAYS } = await request.json()
        const data = await syncHistoryBulk(items, days)
        return NextResponse.json({
            success: true,
            data
        })
    } catch (e) {
        return NextResponse.json(
            { success: false, error: e.message },
            { status: 500 }
        )
    }
}