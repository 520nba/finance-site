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
        if (latency < 800) return 'healthy'; // 1500->800, 真正的健康
        if (latency < 1500) return 'wary';    // 超过 800 开始略显疲态
        if (latency < 3000) return 'slow';    // 极慢
        return 'warning';
    }

    const healthTasks = [
        {
            name: 'Hist: EastMoney (Stock)',
            fn: async () => {
                const data = await fetchStockEastmoney(STOCK_TEST, 1);
                return data && data.length > 0 && typeof data[0].value === 'number';
            }
        },
        {
            name: 'Hist: Tencent (Stock)',
            fn: async () => {
                const data = await fetchStockTencent(STOCK_TEST, 1);
                return data && data.length > 0 && typeof data[0].value === 'number';
            }
        },
        {
            name: 'Hist: Sina (Stock)',
            fn: async () => {
                const data = await fetchStockSina(STOCK_TEST, 1);
                return data && data.length > 0 && typeof data[0].value === 'number';
            }
        },
        {
            name: 'Hist: EastMoney (Fund)',
            fn: async () => {
                const data = await fetchFundHistory(FUND_TEST, 1);
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

    // 并行执行：巡检速度从 15s+ 缩短至 1s~2s 左右
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

        const stats = {
            status: computeStatus(success, latency),
            successRate: success ? 100 : 0, // HealthRepo 会根据此值进行滚动累计计算
            avgLatency: latency,
            errorMsg: success ? '' : (errorMsg || 'IO Error')
        };

        // 异步写入 D1，由于 HealthRepo 内部没有进行耗时读操作，可以并行
        await updateApiHealth(task.name, stats);
        return { name: task.name, ...stats };
    }));

    const verifyCount = (await queryOne('SELECT COUNT(*) as count FROM api_health'))?.count || 0;

    // 只有在全部任务完成后才记录一次系统汇总日志
    const msg = `Sentinel verified ${results.length} nodes. Success: ${results.filter(r => r.status === 'healthy').length}`;
    await addSystemLog('INFO', 'Sentinel', msg);

    return NextResponse.json({ success: true, count: results.length, data: results });
}
