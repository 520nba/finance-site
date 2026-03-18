/**
 * src/lib/cron/sentinel.js
 *
 * 外部财经接口健康巡检
 */

import {
    fetchStockEastmoney,
    fetchStockTencent,
    fetchStockSina,
    fetchFundHistory,
} from '@/lib/services/historyFetcher';
import { queryAll, runSql, getD1Storage } from '@/lib/storage/d1Client';
import { batchUpdateApiHealth } from '@/lib/storage/healthRepo';

// ── 常量 ────────────────────────────────────────────────────────────────────
const TIMEOUT_MS = 5000;

// ── 探针定义 (修改为接收采样资产的动态函数) ─────────────────────────────────

const CREATE_HEALTH_TASKS = (stockCode, fundCode) => [
    {
        name: 'Hist: EastMoney (Stock)',
        fn: async (signal) => {
            const d = await fetchStockEastmoney(stockCode, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Hist: Tencent (Stock)',
        fn: async (signal) => {
            const d = await fetchStockTencent(stockCode, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Hist: Sina (Stock)',
        fn: async (signal) => {
            const d = await fetchStockSina(stockCode, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Hist: EastMoney (Fund)',
        fn: async (signal) => {
            const d = await fetchFundHistory(fundCode, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Quote: Tencent (Realtime)',
        fn: async (signal) => {
            const res = await fetch(`https://qt.gtimg.cn/q=${stockCode}`, {
                headers: { Referer: 'https://gu.qq.com/' }, signal,
            });
            const text = await res.text();
            return res.ok && text.includes(stockCode.replace(/[a-z]/g, '')) && text.split('~').length > 10;
        },
    },
    {
        name: 'Intra: EastMoney (Trends)',
        fn: async (signal) => {
            const secid = stockCode.startsWith('sh') ? `1.${stockCode.slice(2)}` : `0.${stockCode.slice(2)}`;
            const res = await fetch(
                `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1&fields2=f51`,
                { headers: { Referer: 'https://quote.eastmoney.com/' }, signal }
            );
            const d = await res.json();
            return !!(res.ok && d?.data?.trends?.length > 0);
        },
    },
    {
        name: 'Name: EastMoney (Query)',
        fn: async (signal) => {
            const secid = stockCode.startsWith('sh') ? `1.${stockCode.slice(2)}` : `0.${stockCode.slice(2)}`;
            const res = await fetch(
                `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f58`,
                { headers: { Referer: 'https://quote.eastmoney.com/' }, signal }
            );
            const d = await res.json();
            return !!(res.ok && d?.data?.f58);
        },
    },
    {
        name: 'Name: Tencent (Fund Spec)',
        fn: async (signal) => {
            const res = await fetch(`https://qt.gtimg.cn/q=s_jj${fundCode}`, {
                headers: { Referer: 'https://gu.qq.com/' }, signal,
            });
            const text = await res.text();
            return res.ok && text.includes(fundCode);
        },
    },
    {
        name: 'Name: EastMoney (Fund HTML)',
        fn: async (signal) => {
            const res = await fetch(`https://fund.eastmoney.com/${fundCode}.html`, {
                headers: { Referer: 'https://fund.eastmoney.com/', Accept: 'text/html' }, signal,
            });
            const text = await res.text();
            return res.ok && text.includes(fundCode);
        },
    },
];

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runSentinel(env) {
    const db = await getD1Storage(env);
    if (!db) {
        console.error('[Sentinel] DB unreachable, skipping');
        return;
    }

    // 动态采样逻辑：从用户资产库随机选取一个股票和一个基金作为拨测标的
    const sampleStock = await db.prepare("SELECT code FROM user_assets WHERE type = 'stock' ORDER BY RANDOM() LIMIT 1").first();
    const sampleFund = await db.prepare("SELECT code FROM user_assets WHERE type = 'fund' ORDER BY RANDOM() LIMIT 1").first();

    const stockCode = sampleStock?.code || 'sh600036'; // 兜底招行
    const fundCode = sampleFund?.code || '110020';   // 兜底易方达沪深300

    const tasks = CREATE_HEALTH_TASKS(stockCode, fundCode);
    const results = await Promise.all(tasks.map(_probeOne));

    // 调用统一的健康度同步仓库，确保成功率和滑动窗口被正确计算
    await batchUpdateApiHealth(results.map(r => ({
        ...r,
        avgLatency: r.latency // healthRepo 使用的是 avgLatency 字段名
    })), env);

    const available = results.filter(r => r.status !== 'down').length;
    const slaOk = results.filter(r => ['healthy', 'wary'].includes(r.status)).length;
    const failures = results.filter(r => r.status === 'down');

    let msg = `Sentinel done — Availability: ${available}/${results.length}, SLA OK: ${slaOk}/${results.length}`;
    if (failures.length > 0) {
        msg += `. Down: ${failures.map(f => f.name).join(', ')}`;
    }

    console.log(`[Sentinel] ${msg}`);
    await _log(db, slaOk < results.length ? 'WARN' : 'INFO', 'Sentinel', msg);
}

// ── 单探针执行 ───────────────────────────────────────────────────────────────

async function _probeOne(task) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const t0 = Date.now();
    let success = false;
    let errorMsg = '';

    try {
        success = await task.fn(ctrl.signal);
        if (!success) errorMsg = 'Empty or invalid response';
    } catch (e) {
        errorMsg = e.name === 'AbortError'
            ? `Timeout (>${TIMEOUT_MS}ms)`
            : e.message;
    } finally {
        clearTimeout(tid);
    }

    const latency = Date.now() - t0;
    return {
        name: task.name,
        status: _computeStatus(success, latency),
        latency,
        errorMsg: success ? '' : errorMsg,
    };
}

// ── 状态判别 ─────────────────────────────────────────────────────────────────

function _computeStatus(success, latency) {
    if (!success) return 'down';
    if (latency < 1200) return 'healthy';
    if (latency < 2200) return 'wary';
    if (latency < 3500) return 'slow';
    return 'critical';
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

async function _log(db, level, source, message) {
    try {
        await db
            .prepare('INSERT INTO system_logs (level, module, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
            .bind(level, source, message)
            .run();
    } catch (e) {
        console.error('[Sentinel] log write failed:', e.message);
    }
}
