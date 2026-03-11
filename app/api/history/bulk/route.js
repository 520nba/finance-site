import { NextResponse } from 'next/server'
import pLimit from 'p-limit'

import {
    insertDailyPricesBatch,
    getBulkHistory,
    addToSyncQueue
} from '@/lib/storage/historyRepo'

const HISTORY_DAYS = 250

/**
 * =============================
 * 工具函数
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

// ... (bjDate, todayStr, daysBetween, fetch 工具, fetch 数据源函数等保留，供后续 Cron 复用或内部调用)

/**
 * =============================
 * 核心同步 (异步架构重构版)
 * =============================
 */

export async function syncHistoryBulk(items, days = HISTORY_DAYS) {
    if (!items?.length) return {}

    // 1. 从 D1 获取缓存的历史数据
    const dbHistoryMap = await getBulkHistory(items, days)
    const result = {}
    const toSyncQueue = []
    const today = todayStr()

    for (const item of items) {
        const key = `${item.type}:${item.code}`
        const dbHistory = dbHistoryMap[key] || []

        // 标记为正在同步的情况：完全没有历史数据
        if (dbHistory.length === 0) {
            result[key] = {
                status: 'syncing',
                history: [],
                summary: { perf5d: 0, perf22d: 0, perf250d: 0 }
            }
            toSyncQueue.push(item)
            continue
        }

        // 增量同步判断：如果最新日期不是今天，也需要入队异步更新
        const latestDate = dbHistory[dbHistory.length - 1].date
        const gap = daysBetween(latestDate, today)

        if (gap > 0) {
            // 虽然有数据可以展示，但仍需入队以在后台更新最新点
            toSyncQueue.push(item)
        }

        // 无论是否需要更新最新点，都先返回当前 D1 中的数据
        result[key] = {
            status: gap > 0 ? 'updating' : 'ready',
            history: dbHistory,
            summary: calcStats(dbHistory)
        }
    }

    // 2. 异步入队：将缺失数据或需要更新的资产推入 sync_queue
    if (toSyncQueue.length > 0) {
        await addToSyncQueue(toSyncQueue)
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
        console.error('[HistoryBulkAPI] Fatal Error:', e);
        return NextResponse.json(
            { success: false, error: e.message },
            { status: 500 }
        )
    }
}