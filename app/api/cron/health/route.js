import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { updateApiHealth } from '@/lib/storage/healthRepo';
import { fetchStockEastmoney, fetchStockTencent, fetchStockSina, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';
import { queryOne } from '@/lib/storage/d1Client';

/**
 * 外部 API 深度巡检器 (Sentinel V2: Parallel, Tiny Logs, Status Logic Optimized)
 */
export async function GET() {
    const STOCK_TEST = 'sh600036';
    const FUND_TEST = '110020';

    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    /**
     * Timeout 封装：防止单个 API 挂起导致整个 Sentinel 被杀死
     */
    async function safeFetchWithVerify(taskFn, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
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
        if (latency < 4000) return 'slow';
        return 'critical';
    }

    const healthTasks = [
        {
            name: 'Hist: EastMoney (Stock)',
            fn: async (signal) => {
                const data = await fetchStockEastmoney(STOCK_TEST, 1, signal);
                return data && data.length > 0 && typeof data[0].value === 'number';
            }
        },
        {
            name: 'Hist: Tencent (Stock)',
            fn: async (signal) => {
                const data = await fetchStockTencent(STOCK_TEST, 1, signal);
                return data && data.length > 0 && typeof data[0].value === 'number';
            }
        },
        {
            name: 'Hist: Sina (Stock)',
            fn: async (signal) => {
                const data = await fetchStockSina(STOCK_TEST, 1, signal);
                return data && data.length > 0 && typeof data[0].value === 'number';
            }
        },
        {
            name: 'Hist: EastMoney (Fund)',
            fn: async (signal) => {
                const data = await fetchFundHistory(FUND_TEST, 1, signal);
                return data && data.length > 0 && typeof data[0].value === 'number';
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
                return res.ok && d?.data?.trends?.length > 0;
            }
        },
        {
            name: 'Name: EastMoney (Query)',
            fn: async (signal) => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=1.600036&fields=f58`, { headers: { 'Referer': 'https://quote.eastmoney.com/' }, signal });
                const d = await res.json();
                return res.ok && d?.data?.f58 === '招商银行';
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
            success = await safeFetchWithVerify(task.fn, 6000);
            latency = Date.now() - start;
            if (!success) errorMsg = 'Data Integrity Error';
        } catch (e) {
            latency = Date.now() - start;
            errorMsg = e.name === 'AbortError' ? 'Timeout (6s)' : e.message;
        }

        return {
            name: task.name,
            status: computeStatus(success, latency),
            successRate: `${success ? 1 : 0}/1`,
            avgLatency: latency,
            errorMsg: success ? '' : (errorMsg || 'IO Error')
        };
    }));

    // 串行写入 D1，防止 SQLite 并发写瓶颈
    for (const r of results) {
        await updateApiHealth(r.name, r);
    }

    // 更新系统汇总日志 (排除 down 状态即算广义成功)
    const successCount = results.filter(r => r.status !== 'down').length;
    const msg = `Sentinel verified ${results.length} nodes. Success: ${successCount}`;
    await addSystemLog('INFO', 'Sentinel', msg);

    return NextResponse.json({ success: true, count: results.length, data: results });
}
