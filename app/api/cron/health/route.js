import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { batchUpdateApiHealth } from '@/lib/storage/healthRepo';
import { fetchStockEastmoney, fetchStockTencent, fetchStockSina, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';
import { syncCounterFromTable } from '@/lib/storage/statsRepo';

/**
 * 外部 API 深度巡检器 (Sentinel V3: Parallel, Batch Writes, Optimized Timeouts)
 */
export async function GET() {
    const STOCK_TEST = 'sh600036';
    const FUND_TEST = '110020';
    const GLOBAL_TIMEOUT = 4500; // 与 computeStatus 阈值对齐，设为 4.5s

    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    /**
     * Timeout 封装：防止单个 API 挂起导致整个 Sentinel 被杀死
     * 确保信号被透传，且超时时间严格控制。
     */
    async function safeFetchWithVerify(taskFn, timeout = GLOBAL_TIMEOUT) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            // taskFn 必须接收并透传 signal 给底层的 fetch
            return await taskFn(controller.signal);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * 健康状态判别逻辑 (精细化视角)
     */
    function computeStatus(success, latency) {
        if (!success) return 'down';
        if (latency < 1200) return 'healthy';
        if (latency < 2200) return 'wary';
        if (latency < 3500) return 'slow';
        return 'critical';
    }

    const healthTasks = [
        {
            name: 'Hist: EastMoney (Stock)',
            fn: async (signal) => {
                const data = await fetchStockEastmoney(STOCK_TEST, 1, signal);
                return !!(data && data.length > 0 && typeof data[0].value === 'number');
            }
        },
        {
            name: 'Hist: Tencent (Stock)',
            fn: async (signal) => {
                const data = await fetchStockTencent(STOCK_TEST, 1, signal);
                return !!(data && data.length > 0 && typeof data[0].value === 'number');
            }
        },
        {
            name: 'Hist: Sina (Stock)',
            fn: async (signal) => {
                const data = await fetchStockSina(STOCK_TEST, 1, signal);
                return !!(data && data.length > 0 && typeof data[0].value === 'number');
            }
        },
        {
            name: 'Hist: EastMoney (Fund)',
            fn: async (signal) => {
                const data = await fetchFundHistory(FUND_TEST, 1, signal);
                return !!(data && data.length > 0 && typeof data[0].value === 'number');
            }
        },
        {
            name: 'Quote: Tencent (Realtime)',
            fn: async (signal) => {
                const res = await fetch(`https://qt.gtimg.cn/q=${STOCK_TEST}`, { headers: { 'Referer': 'https://gu.qq.com/' }, signal });
                const text = await res.text();
                return res.ok && text.includes('600036') && text.split('~').length > 10;
            }
        },
        {
            name: 'Intra: EastMoney (Trends)',
            fn: async (signal) => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1&fields2=f51`, { headers: { 'Referer': 'https://quote.eastmoney.com/' }, signal });
                const d = await res.json();
                return !!(res.ok && d?.data?.trends?.length > 0);
            }
        },
        {
            name: 'Name: EastMoney (Query)',
            fn: async (signal) => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=1.600036&fields=f58`, { headers: { 'Referer': 'https://quote.eastmoney.com/' }, signal });
                const d = await res.json();
                return !!(res.ok && d?.data?.f58 === '招商银行');
            }
        },
        {
            name: 'Name: Tencent (Fund Spec)',
            fn: async (signal) => {
                const res = await fetch(`https://qt.gtimg.cn/q=s_jj${FUND_TEST}`, { headers: BASE_HEADERS, signal });
                const text = await res.text();
                return res.ok && text.includes('110020');
            }
        },
        {
            name: 'Name: EastMoney (Fund HTML)',
            fn: async (signal) => {
                const res = await fetch(`https://fund.eastmoney.com/${FUND_TEST}.html`, { headers: { ...BASE_HEADERS, 'Accept': 'text/html' }, signal });
                const text = await res.text();
                return res.ok && text.includes(FUND_TEST);
            }
        }
    ];

    // 并行执行 API 巡检
    const results = await Promise.all(healthTasks.map(async (task) => {
        const start = Date.now();
        let success = false;
        let latency = 0;
        let errorMsg = '';

        try {
            success = await safeFetchWithVerify(task.fn, GLOBAL_TIMEOUT);
            latency = Date.now() - start;
            if (!success) errorMsg = 'Data Integrity Mocked / Empty Response';
        } catch (e) {
            latency = Date.now() - start;
            errorMsg = e.name === 'AbortError' ? `Timeout (${GLOBAL_TIMEOUT}ms)` : e.message;
        }

        return {
            name: task.name,
            status: computeStatus(success, latency),
            avgLatency: latency,
            isSuccess: success,
            errorMsg: success ? '' : (errorMsg || 'IO Error')
        };
    }));

    // 批量写入 D1，优化 Wall Time 并减少 CPU 消耗
    await batchUpdateApiHealth(results);

    // 自动修正同步队列计数器 (防止长期的计数偏离)
    await syncCounterFromTable('queue_count', 'sync_queue');

    // 精细化可用性与 SLA 指标
    // Availability: 节点尚存 (状态不为 down)
    // SLA OK: 服务质量达标 (healthy 或 wary)
    const availabilitySuccess = results.filter(r => r.status !== 'down').length;
    const slaSuccess = results.filter(r => ['healthy', 'wary'].includes(r.status)).length;

    const msg = `Sentinel V3 Verified. Availability: ${availabilitySuccess}/${results.length}, SLA OK: ${slaSuccess}/${results.length}`;
    await addSystemLog('INFO', 'Sentinel', msg);

    return NextResponse.json({
        success: true,
        count: results.length,
        availability_rate: `${Math.round((availabilitySuccess / results.length) * 100)}%`,
        sla_rate: `${Math.round((slaSuccess / results.length) * 100)}%`,
        data: results
    });
}
