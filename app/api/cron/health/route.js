import { NextResponse } from 'next/server';
import { updateApiHealth } from '@/lib/storage/healthRepo';
import { fetchStockEastmoney, fetchStockTencent, fetchStockSina, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';

export const dynamic = 'force-dynamic';

/**
 * API 定时健康巡检 (Cron 触发)
 * 每 5-10 分钟运行一次。尝试拉取一个固定测试资产的数据并统计指标。
 */
export async function GET() {
    // 测试资产：招商银行 (600036/sh600036) 和 沪深300ETF联接A (110020)
    const STOCK_TEST = 'sh600036';
    const FUND_TEST = '110020';

    const healthTasks = [
        { name: 'EastMoney', fn: () => fetchStockEastmoney(STOCK_TEST, 1) },
        { name: 'Tencent', fn: () => fetchStockTencent(STOCK_TEST, 1) },
        { name: 'Sina', fn: () => fetchStockSina(STOCK_TEST, 1) },
        { name: 'Fund API', fn: () => fetchFundHistory(FUND_TEST, 1) }
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
            if (data && data.length > 0) {
                success = true;
            } else {
                errorMsg = 'Empty data returned';
            }
        } catch (e) {
            latency = Date.now() - start;
            errorMsg = e.message;
        }

        const stats = {
            status: success ? (latency < 1000 ? 'healthy' : 'wary') : 'down',
            successRate: success ? 100 : 0, // 这里的逻辑可以优化为在 Repo 层聚合历史
            avgLatency: latency,
            errorMsg: success ? '' : (errorMsg || 'Connection reset')
        };

        await updateApiHealth(task.name, stats);
        results.push({ name: task.name, ...stats });
    }

    await addSystemLog('INFO', 'HealthCron', `API Check results: ${results.length} tested.`);

    return NextResponse.json({ success: true, data: results });
}
