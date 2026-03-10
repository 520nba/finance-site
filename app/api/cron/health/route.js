import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { updateApiHealth } from '@/lib/storage/healthRepo';
import { fetchStockEastmoney, fetchStockTencent, fetchStockSina, fetchFundHistory } from '@/lib/services/historyFetcher';
import { addSystemLog } from '@/lib/storage/logRepo';
import { queryOne } from '@/lib/storage/d1Client';

/**
 * 外部 API 深度巡检器 (Deep Sentinel Feedback)
 * 验证逻辑：不仅检查 HTTP 200，还要验证业务数据结构是否符合预期，从而防御频率限制、验证码或空结果。
 */
export async function GET() {
    const STOCK_TEST = 'sh600036';
    const FUND_TEST = '110020';

    const BASE_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const healthTasks = [
        // 1. 历史数据校验
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

        // 2. 实时行情与报价结构校验
        {
            name: 'Quote: Tencent (Realtime)',
            fn: async () => {
                const res = await fetch(`https://qt.gtimg.cn/q=${STOCK_TEST}`, { headers: { 'Referer': 'https://gu.qq.com/' } });
                const text = await res.text();
                // 腾讯接口返回 v_sh600036="..." 包含股票名和价格
                return res.ok && text.includes('招商银行') && text.split('~').length > 10;
            }
        },

        // 3. 分时趋势校验
        {
            name: 'Intra: EastMoney (Trends)',
            fn: async () => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1&fields2=f51`, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
                const d = await res.json();
                return res.ok && d?.data?.trends?.length > 0;
            }
        },

        // 4. 信息查询接口校验
        {
            name: 'Name: EastMoney (Query)',
            fn: async () => {
                const res = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=1.600036&fields=f58`, { headers: { 'Referer': 'https://quote.eastmoney.com/' } });
                const d = await res.json();
                return res.ok && d?.data?.f58 === '招商银行';
            }
        },
        {
            name: 'Name: Tencent (Fund Spec)',
            fn: async () => {
                const res = await fetch(`https://qt.gtimg.cn/q=s_jj${FUND_TEST}`, { headers: BASE_HEADERS });
                const text = await res.text();
                return res.ok && text.includes('沪深300');
            }
        },
        {
            name: 'Name: EastMoney (Fund HTML)',
            fn: async () => {
                const res = await fetch(`https://fund.eastmoney.com/${FUND_TEST}.html`, { headers: { ...BASE_HEADERS, 'Accept': 'text/html' } });
                const text = await res.text();
                return res.ok && text.includes('易方达');
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
            success = await task.fn();
            latency = Date.now() - start;
            if (!success) {
                errorMsg = 'Data Integrity Mocked / Empty Response';
            }
        } catch (e) {
            latency = Date.now() - start;
            errorMsg = e.message;
        }

        const stats = {
            status: success ? (latency < 1500 ? 'healthy' : 'wary') : 'down',
            successRate: success ? 100 : 0,
            avgLatency: latency,
            errorMsg: success ? '' : (errorMsg || 'IO Error')
        };

        await updateApiHealth(task.name, stats);
        results.push({ name: task.name, ...stats });
    }

    const verifyCount = (await queryOne('SELECT COUNT(*) as count FROM api_health'))?.count || 0;
    await addSystemLog('INFO', 'HealthCron', `Sentinel Deep Check: ${results.length} nodes verified. Post-Write Table Size: ${verifyCount}`);

    return NextResponse.json({ success: true, count: results.length, table_size: verifyCount, details: results });
}
