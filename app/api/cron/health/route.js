import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { updateApiHealth } from '@/lib/storage/healthRepo';
import { fetchStockEastmoney, fetchStockTencent, fetchStockSina, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';

/**
 * API 定时健康巡检 (Cron 触发)
 * 每 5-10 分钟运行一次。尝试拉取一个固定测试资产的数据并统计指标。
 */
export async function GET() {
    // 测试资产：招商银行 (600036/sh600036) 和 沪深300ETF联接A (110020)
    const STOCK_TEST = 'sh600036';
    const FUND_TEST = '110020';

    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const healthTasks = [
        // 1. 历史 K 线系列
        { name: 'Hist: EastMoney (Stock)', fn: () => fetchStockEastmoney(STOCK_TEST, 1) },
        { name: 'Hist: Tencent (Stock)', fn: () => fetchStockTencent(STOCK_TEST, 1) },
        { name: 'Hist: Sina (Stock)', fn: () => fetchStockSina(STOCK_TEST, 1) },
        { name: 'Hist: EastMoney (Fund)', fn: () => fetchFundHistory(FUND_TEST, 1) },

        // 2. 实时行情系列
        {
            name: 'Quote: Tencent (Realtime)',
            fn: async () => {
                const res = await fetch(`https://qt.gtimg.cn/q=${STOCK_TEST}`, { headers: { 'Referer': 'https://gu.qq.com/' } });
                return res.ok ? [1] : null;
            }
        },

        // 3. 分时趋势系列
        {
            name: 'Intra: EastMoney (Trends)',
            fn: async () => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1&fields2=f51`, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
                return res.ok ? [1] : null;
            }
        },

        // 4. 名称获取系列 (用于 Search/Update)
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

        // 异步更新健康信息，增加适当错误捕获
        updateApiHealth(task.name, stats).catch(err => {
            console.warn(`[HealthCron] Async update failed for ${task.name}:`, err.message);
        });

        results.push({ name: task.name, ...stats });
    }

    addSystemLog('INFO', 'HealthCron', `Sentinel: ${results.length} nodes verified.`).catch(() => { });

    return NextResponse.json({ success: true, data: results });
}
