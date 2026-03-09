import { NextResponse } from 'next/server'
import pLimit from 'p-limit'

import { getGlobalUniqueAssets } from '@/lib/storage/userRepo'
import { syncNamesBulk } from '@/app/api/names/bulk/route'
import { refreshStockHistoryTransaction, incrementalUpdateFundHistory, getHistory } from '@/lib/storage/historyRepo'
import { saveIntradayPointsBulk, pruneIntradayPoints } from '@/lib/storage/intradayRepo'
import { addSystemLog } from '@/lib/storage/logRepo'

/**
 * =============================
 * 基础配置
 * =============================
 */

const limit = pLimit(5)

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': '*/*',
    'Referer': 'https://quote.eastmoney.com/'
}

/**
 * =============================
 * 工具函数
 * =============================
 */

// 获取北京时间
function getBJTime() {
    const bj = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
    )

    return {
        date: bj,
        hour: bj.getHours(),
        minute: bj.getMinutes(),
        dateStr: bj.toISOString()
    }
}

/**
 * fetch + timeout + retry
 */
async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 12000) {

    for (let i = 0; i <= retries; i++) {

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)

        try {

            const res = await fetch(url, {
                ...options,
                signal: controller.signal
            })

            clearTimeout(timeout)

            if (res.ok) return res

        } catch (e) {

            if (i === retries) throw e

        }
    }

    return null
}

/**
 * =============================
 * 东方财富数据接口
 * =============================
 */

// 股票历史
async function fetchRawStockHistory(code, days = 250) {

    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i)
    if (!match) return null

    const mkt = match[1].toLowerCase() === 'sz' ? '0' : '1'
    const clean = match[2]

    const url =
        `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
        `?secid=${mkt}.${clean}` +
        `&fields1=f1,f2` +
        `&fields2=f51,f53` +
        `&klt=101&fqt=1&end=20500101` +
        `&lmt=${days + 10}`

    try {

        const res = await fetchWithRetry(url)

        if (!res) return null

        const d = await res.json()

        if (!d?.data?.klines) return null

        return d.data.klines
            .map(line => {
                const p = line.split(',')
                return {
                    date: p[0],
                    value: parseFloat(p[1])
                }
            })
            .filter(i => !isNaN(i.value))

    } catch (e) {

        console.error('stock history error', code, e.message)

        return null
    }
}


// 基金历史
async function fetchRawFundHistory(code, startDate) {

    const match = code.match(/^([a-zA-Z]{2})?(\d+)$/i)
    const clean = match ? match[2] : code

    const url =
        `https://api.fund.eastmoney.com/f10/lsjz` +
        `?fundCode=${clean}` +
        `&pageIndex=1&pageSize=200` +
        `&_=${Date.now()}`

    try {

        const res = await fetchWithRetry(url, {
            headers: {
                ...BASE_HEADERS,
                Referer: 'http://fundf10.eastmoney.com/'
            }
        })

        if (!res) return null

        const d = await res.json()

        const list = d?.Data?.LSJZList || []

        return list
            .filter(i => !startDate || i.FSRQ >= startDate)
            .map(i => ({
                date: i.FSRQ,
                value: parseFloat(i.DWJZ)
            }))
            .filter(i => !isNaN(i.value))
            .reverse()

    } catch (e) {

        console.error('fund history error', code)

        return null
    }
}


// 股票实时
async function fetchCurrentIntradayPoint(code) {

    const match = code.match(/^([a-zA-Z]{2})(\d+)$/i)
    if (!match) return null

    const mkt = match[1].toLowerCase() === 'sz' ? '0' : '1'
    const clean = match[2]

    const url =
        `https://push2.eastmoney.com/api/qt/stock/get` +
        `?secid=${mkt}.${clean}&fields=f43,f47,f86`

    try {

        const res = await fetchWithRetry(url)

        if (!res) return null

        const d = await res.json()

        const f = d?.data

        if (!f || f.f43 === '-') return null

        const price = f.f43 / 100
        const vol = f.f47 || 0

        const { date } = getBJTime()

        const t = f.f86 || '000000'

        const time =
            `${date.toISOString().split('T')[0]} ` +
            `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`

        return { code, time, price, vol }

    } catch {

        return null
    }
}


/**
 * =============================
 * 任务逻辑
 * =============================
 */

async function runStockRefresh(stocks) {

    await Promise.all(

        stocks.map(s =>
            limit(async () => {

                const history = await fetchRawStockHistory(s.code, 250)

                if (history)
                    await refreshStockHistoryTransaction(s.code, history)

            })
        )
    )
    await addSystemLog('INFO', 'Cron', `Stock History Refresh: Completed for ${stocks.length} assets.`);
}


async function runFundUpdate(funds) {

    await Promise.all(

        funds.map(f =>
            limit(async () => {

                const current = await getHistory(f.code, 'fund', 1)

                const lastDate =
                    current.length > 0 ? current[0].date : null

                const newRecords =
                    await fetchRawFundHistory(f.code, lastDate)

                if (newRecords?.length)
                    await incrementalUpdateFundHistory(f.code, newRecords)

            })
        )
    )
    await addSystemLog('INFO', 'Cron', `Fund Daily Update: Completed for ${funds.length} assets.`);
}


async function runIntradayPoll(stocks) {

    const points = await Promise.all(

        stocks.map(s =>
            limit(() => fetchCurrentIntradayPoint(s.code))
        )
    )

    const valid = points.filter(Boolean)

    if (valid.length) {
        await saveIntradayPointsBulk(valid);
        await addSystemLog('DEBUG', 'Cron', `Intraday Poll: Captured ${valid.length} points.`);
    }
}


/**
 * =============================
 * API
 * =============================
 */

export async function GET(req) {

    const { searchParams } = new URL(req.url)

    const token = searchParams.get('token')
    const task = searchParams.get('task') || 'auto'

    const secret = process.env.CRON_SECRET

    if (process.env.NODE_ENV === 'production') {

        if (!secret || token !== secret)
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 403 }
            )
    }

    const bj = getBJTime()

    const { hour, minute } = bj

    try {

        const items = await getGlobalUniqueAssets()

        if (!items.length)
            return NextResponse.json({ success: true })

        const stocks = items.filter(i => i.type === 'stock')
        const funds = items.filter(i => i.type === 'fund')

        const results = []

        /**
         * 股票历史刷新
         */
        if (
            task === 'stock_refresh' ||
            (task === 'auto' && hour === 4 && minute < 10)
        ) {

            await runStockRefresh(stocks)

            results.push('stock_refresh')
        }

        /**
         * 基金更新
         */
        if (
            task === 'fund_update' ||
            (task === 'auto' &&
                (hour === 3 || hour === 8) &&
                minute < 10)
        ) {

            await runFundUpdate(funds)

            results.push('fund_update')
        }

        /**
         * 交易时间
         */

        const morning =
            (hour === 9 && minute >= 30) ||
            hour === 10 ||
            (hour === 11 && minute <= 30)

        const afternoon =
            hour === 13 ||
            hour === 14 ||
            (hour === 15 && minute === 0)

        const isMarketTime = morning || afternoon

        if (
            task === 'intraday_poll' ||
            (task === 'auto' && isMarketTime)
        ) {

            await runIntradayPoll(stocks)

            results.push('intraday_poll')
        }

        /**
         * 分时清理
         */
        if (
            task === 'intraday_cleanup' ||
            (task === 'auto' && hour === 15 && minute === 30)
        ) {

            await pruneIntradayPoints()

            results.push('intraday_cleanup')
        }

        /**
         * 名称同步
         */
        if (
            task === 'names' ||
            (task === 'auto' && hour === 2 && minute < 10)
        ) {

            await syncNamesBulk(items, true)

            results.push('names')
        }

        if (results.length > 0) {
            await addSystemLog('INFO', 'Cron', `Tasks Executed: ${results.join(', ')}`);
        }

        return NextResponse.json({
            success: true,
            bjTime: bj.dateStr,
            tasks: results
        })

    } catch (e) {
        await addSystemLog('ERROR', 'Cron', `Sync crashed: ${e.message}`);
        return NextResponse.json(
            { error: e.message },
            { status: 500 }
        )
    }
}