/**
 * src/lib/cron/sentinel.js
 *
 * 外部财经接口健康巡检，每 15 分钟由 scheduled handler 调用。
 *
 * 修复原 Sentinel V3 的问题：
 *   1. 9 个探针共享一个 AbortController → 改为每探针独立，超时互不影响
 *   2. syncCounterFromTable 副作用混入 → 完全移除
 *   3. HTTP GET route 无法被 cron 触发 → 改为 scheduled handler 纯函数
 *
 * 流程：
 *   1. 9 个探针全部并行，各自独立超时
 *   2. 结果 UPSERT 写入 api_health 表（一探针一行，覆盖上次结果）
 *   3. 汇总可用性与 SLA 指标写 system_logs
 */

import {
    fetchStockEastmoney,
    fetchStockTencent,
    fetchStockSina,
    fetchFundHistory,
} from '@/lib/services/historyFetcher';
import { queryAll, runSql, getD1Storage } from '@/lib/storage/d1Client'; // 修复导入缺失

// ── 常量 ────────────────────────────────────────────────────────────────────

const STOCK_TEST = 'sh600036';
const FUND_TEST = '110020';
const TIMEOUT_MS = 4500;

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ── 探针定义 ─────────────────────────────────────────────────────────────────
//
// fn(signal) → boolean
//   true  = 接口正常，数据有效
//   false = 接口响应但数据异常
//   throw = 接口超时或网络错误

const HEALTH_TASKS = [
    {
        name: 'Hist: EastMoney (Stock)',
        fn: async (signal) => {
            const d = await fetchStockEastmoney(STOCK_TEST, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Hist: Tencent (Stock)',
        fn: async (signal) => {
            const d = await fetchStockTencent(STOCK_TEST, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Hist: Sina (Stock)',
        fn: async (signal) => {
            const d = await fetchStockSina(STOCK_TEST, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Hist: EastMoney (Fund)',
        fn: async (signal) => {
            const d = await fetchFundHistory(FUND_TEST, 1, signal);
            return !!(d?.length > 0 && typeof d[0].value === 'number');
        },
    },
    {
        name: 'Quote: Tencent (Realtime)',
        fn: async (signal) => {
            const res = await fetch(`https://qt.gtimg.cn/q=${STOCK_TEST}`, {
                headers: { Referer: 'https://gu.qq.com/' }, signal,
            });
            const text = await res.text();
            return res.ok && text.includes('600036') && text.split('~').length > 10;
        },
    },
    {
        name: 'Intra: EastMoney (Trends)',
        fn: async (signal) => {
            const res = await fetch(
                `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1&fields2=f51`,
                { headers: { Referer: 'https://quote.eastmoney.com/' }, signal }
            );
            const d = await res.json();
            return !!(res.ok && d?.data?.trends?.length > 0);
        },
    },
    {
        name: 'Name: EastMoney (Query)',
        fn: async (signal) => {
            const res = await fetch(
                `https://push2.eastmoney.com/api/qt/stock/get?secid=1.600036&fields=f58`,
                { headers: { Referer: 'https://quote.eastmoney.com/' }, signal }
            );
            const d = await res.json();
            return !!(res.ok && d?.data?.f58 === '招商银行');
        },
    },
    {
        name: 'Name: Tencent (Fund Spec)',
        fn: async (signal) => {
            const res = await fetch(`https://qt.gtimg.cn/q=s_jj${FUND_TEST}`, {
                headers: BASE_HEADERS, signal,
            });
            const text = await res.text();
            return res.ok && text.includes(FUND_TEST);
        },
    },
    {
        name: 'Name: EastMoney (Fund HTML)',
        fn: async (signal) => {
            const res = await fetch(`https://fund.eastmoney.com/${FUND_TEST}.html`, {
                headers: { ...BASE_HEADERS, Accept: 'text/html' }, signal,
            });
            const text = await res.text();
            return res.ok && text.includes(FUND_TEST);
        },
    },
];

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function runSentinel(env_orig) { // 统合规范：直接使用 getD1Storage() 获取绑定，支持 context 与 global 注入
    const db = await getD1Storage(env_orig);
    const env = { DB: db };

    const results = await Promise.all(HEALTH_TASKS.map(_probeOne));

    await _batchWriteHealth(env, results);

    const available = results.filter(r => r.status !== 'down').length;
    const slaOk = results.filter(r => ['healthy', 'wary'].includes(r.status)).length;
    const failures = results.filter(r => r.status === 'down');

    let msg = `Sentinel done — Availability: ${available}/${results.length}, SLA OK: ${slaOk}/${results.length}`;
    if (failures.length > 0) {
        msg += `. Down: ${failures.map(f => f.name).join(', ')}`;
    }

    console.log(`[Sentinel] ${msg}`);
    await _log(env, slaOk < results.length ? 'WARN' : 'INFO', 'Sentinel', msg);
}

// ── 单探针执行 ───────────────────────────────────────────────────────────────

async function _probeOne(task) {
    // 每个探针独立的 AbortController，超时不影响其他探针
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

    return {
        name: task.name,
        status: _computeStatus(success, Date.now() - t0),
        latency: Date.now() - t0,
        errorMsg: success ? '' : errorMsg,
    };
}

// ── D1 写入 ──────────────────────────────────────────────────────────────────

async function _batchWriteHealth(env, results) {
    const now = new Date().toISOString();
    const stmts = results.map(r =>
        env.DB.prepare(`
            INSERT INTO api_health (name, status, latency, error_msg, checked_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                status     = excluded.status,
                latency    = excluded.latency,
                error_msg  = excluded.error_msg,
                checked_at = excluded.checked_at
        `).bind(r.name, r.status, r.latency, r.errorMsg, now)
    );
    await env.DB.batch(stmts);
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

async function _log(env, level, source, message) {
    try {
        await env.DB
            .prepare('INSERT INTO system_logs (level, source, message, created_at) VALUES (?, ?, ?, ?)')
            .bind(level, source, message, new Date().toISOString())
            .run();
    } catch (e) {
        console.error('[Sentinel] log write failed:', e.message);
    }
}
