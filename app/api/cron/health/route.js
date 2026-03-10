import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { updateApiHealth } from '@/lib/storage/healthRepo';
import { fetchStockEastmoney, fetchStockTencent, fetchStockSina, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';

/**
 * API 定时健康巡检 (Cron 触发)
 */
export async function GET() {
    const STOCK_TEST = 'sh600036';
    const FUND_TEST = '110020';

    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const healthTasks = [
        { name: 'Hist: EastMoney (Stock)', fn: () => fetchStockEastmoney(STOCK_TEST, 1) },
        { name: 'Hist: Tencent (Stock)', fn: () => fetchStockTencent(STOCK_TEST, 1) },
        { name: 'Hist: Sina (Stock)', fn: () => fetchStockSina(STOCK_TEST, 1) },
        { name: 'Hist: EastMoney (Fund)', fn: () => fetchFundHistory(FUND_TEST, 1) },
        {
            name: 'Quote: Tencent (Realtime)',
            fn: async () => {
                const res = await fetch(`https://qt.gtimg.cn/q=${STOCK_TEST}`, { headers: { 'Referer': 'https://gu.qq.com/' } });
                return res.ok ? [1] : null;
            }
        },
        {
            name: 'Intra: EastMoney (Trends)',
            fn: async () => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1&fields2=f51`, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
                return res.ok ? [1] : null;
            }
        },
        {
            name: 'Name: EastMoney (Query)',
            fn: async () => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=1.600036&fields=f58`, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
                return res.ok ? [1] : null;
            }
        },
        {
            name: 'Name: Tencent (Fund Spec)',
            fn: async () => {
                const res = await fetch(`https://qt.gtimg.cn/q=s_jj${FUND_TEST}`, { headers: BASE_HEADERS });
                return res.ok ? [1] : null;
            }
        },
        {
            name: 'Name: EastMoney (Fund HTML)',
            fn: async () => {
                const res = await fetch(`https://fund.eastmoney.com/${FUND_TEST}.html`, { headers: { ...BASE_HEADERS, 'Accept': 'text/html' } });
                return res.ok ? [1] : null;
            }
        }
    ];

    const results = [];

    // 重要：必须逐个/批量 AWAIT 写入操作，在 Cloudflare Workers 环境下不能有悬空的 Promise
    for (const task of healthTasks) {
        const start = Date.now();
        let success = false;
        let latency = 0;
        let errorMsg = '';

        try {
            const data = await task.fn();
            latency = Date.now() - start;
            if (data && (Array.isArray(data) ? data.length > 0 : true)) {
                success = true;
            } else {
                errorMsg = 'Protocol Mismatch';
            }
        } catch (e) {
            latency = Date.now() - start;
            errorMsg = e.message;
        }

        const stats = {
            status: success ? (latency < 1200 ? 'healthy' : 'wary') : 'down',
            successRate: success ? 100 : 0,
            avgLatency: latency,
            errorMsg: success ? '' : (errorMsg || 'IO Error')
        };

        // 同步等待写入 D1，确保任务上下文不被过早杀死
        await updateApiHealth(task.name, stats);
        results.push({ name: task.name, ...stats });
    }

    await addSystemLog('INFO', 'HealthCron', `Sentinel: ${results.length} nodes verified.`);

    return NextResponse.json({ success: true, data: results });
}
