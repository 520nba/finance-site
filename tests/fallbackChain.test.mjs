/**
 * tests/fallbackChain.test.mjs
 *
 * 兜底链路回归测试（离线，stub 掉 globalThis.fetch）
 *   node --test tests/fallbackChain.test.mjs
 *
 * 覆盖：
 *   - 股票历史：东财 → 腾讯 → 新浪，逐级回退，且记录每级失败原因
 *   - 全源失败时 points=null 且 attempts 完整（供任务标记失败）
 *   - 基金历史：pingzhongdata → lsjz 接口
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchStockHistoryDetailed, fetchFundHistoryDetailed } from '../lib/services/historyFetcher.js';

const OLD_DATE = '2024-01-02'; // 远早于今天 → 必定通过「已收盘数据」过滤

/** 北京时间当日 YYYY-MM-DD（与 lib/utils.getBeijingTodayStr 口径一致） */
function beijingTodayStr() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 腾讯 fqkline 响应（JSONP 风格，带结尾分号） */
function tencentKline(code, dates) {
    return textResponse(`kline_dayqfq=${JSON.stringify({
        code: 0,
        data: { [code]: { qfqday: dates.map(d => [d, '0', '100.00']) } }
    })};`);
}

function jsonResponse(obj, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => obj,
        text: async () => JSON.stringify(obj)
    };
}

function textResponse(text, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(text),
        text: async () => text
    };
}

/**
 * 安装一个按 URL 关键字分派的 fetch stub。
 * routes: [{ match: 'push2his', response: fn|obj }]，未命中的一律返回 500。
 */
function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url) => {
        const u = String(url);
        calls.push(u);
        for (const r of routes) {
            if (u.includes(r.match)) {
                if (r.throw) throw new Error(r.throw);
                return typeof r.response === 'function' ? r.response(u) : r.response;
            }
        }
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
    };
    return calls;
}

// ── 股票历史 ────────────────────────────────────────────────────────────────

test('股票历史：东财失败 → 回退腾讯', async () => {
    const calls = stubFetch([
        { match: 'push2his', response: jsonResponse({ data: { klines: [] } }) }, // 空 → 视为失败
        { match: 'fqkline', response: tencentKline('sh600519', [OLD_DATE]) }
    ]);

    const r = await fetchStockHistoryDetailed('sh600519', 5);
    assert.equal(r.source, 'tencent');
    assert.equal(r.points.length, 1);
    assert.equal(r.points[0].date, OLD_DATE);
    assert.equal(r.points[0].value, 100);
    assert.equal(r.attempts[0].source, 'eastmoney');
    assert.ok(calls.some(u => u.includes('fqkline')));
});

test('股票历史：优先选「最新交易日」更靠后的源（陈旧非空不得短路兜底）', async () => {
    // 复现线上问题：腾讯对该标的前复权数据还停在 01-02，新浪已经是 01-05
    stubFetch([
        { match: 'push2his', response: jsonResponse({ data: { klines: [] } }) },
        { match: 'fqkline', response: tencentKline('sh600900', [OLD_DATE]) },
        {
            match: 'sina.com.cn',
            response: jsonResponse([
                { day: `${OLD_DATE} 15:00:00`, close: '10.00' },
                { day: '2024-01-05 15:00:00', close: '11.00' }
            ])
        }
    ]);

    const r = await fetchStockHistoryDetailed('sh600900', 5);
    assert.equal(r.source, 'sina');
    assert.equal(r.points.at(-1).date, '2024-01-05');
    assert.equal(r.points.at(-1).value, 11);
    // 腾讯虽然返回了数据，但被判定为陈旧
    assert.ok(r.attempts.some(a => a.source === 'tencent' && /stale/.test(a.error)));
});

test('股票历史：主源已是当日数据时提前结束，不再打后续源', async () => {
    const today = beijingTodayStr();
    const calls = stubFetch([
        { match: 'push2his', response: jsonResponse({ data: { klines: [`${today},100.00`] } }) },
        { match: 'fqkline', response: tencentKline('sh600519', [today]) }
    ]);

    const r = await fetchStockHistoryDetailed('sh600519', 5);
    assert.equal(r.source, 'eastmoney');
    assert.equal(r.points.at(-1).date, today);
    assert.equal(r.attempts.length, 0);
    assert.equal(calls.filter(u => u.includes('fqkline')).length, 0, '不应再请求腾讯');
});

test('股票历史：东财+腾讯失败 → 回退新浪', async () => {
    stubFetch([
        { match: 'push2his', throw: 'ECONNRESET' },
        { match: 'fqkline', response: textResponse('kline_dayqfq={"code":1,"msg":"bad params"}') },
        {
            match: 'sina.com.cn',
            response: jsonResponse([{ day: `${OLD_DATE} 15:00:00`, close: '9.99' }])
        }
    ]);

    const r = await fetchStockHistoryDetailed('sh600519', 5);
    assert.equal(r.source, 'sina');
    assert.equal(r.points[0].value, 9.99);
    assert.deepEqual(r.attempts.map(a => a.source), ['eastmoney', 'tencent']);
    assert.ok(r.attempts[0].error.length > 0);
});

test('股票历史：三个源全挂 → points 为 null 且 attempts 完整', async () => {
    stubFetch([
        { match: 'push2his', response: { ok: false, status: 520, json: async () => ({}), text: async () => 'error code: 520' } },
        { match: 'fqkline', response: { ok: false, status: 502, json: async () => ({}), text: async () => 'error code: 502' } },
        { match: 'sina.com.cn', throw: 'fetch failed' }
    ]);

    const r = await fetchStockHistoryDetailed('sh600519', 5);
    assert.equal(r.points, null);
    assert.equal(r.source, null);
    assert.deepEqual(r.attempts.map(a => a.source), ['eastmoney', 'tencent', 'sina']);
    assert.match(r.attempts[0].error, /520/);
    assert.match(r.attempts[2].error, /fetch failed/);
});

// ── 基金历史 ────────────────────────────────────────────────────────────────

test('基金历史：pingzhongdata 失败 → 回退 lsjz', async () => {
    stubFetch([
        { match: 'pingzhongdata', response: { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' } },
        {
            match: 'lsjz',
            response: jsonResponse({ Data: [{ FSRQ: '2024-01-03', DWJZ: '1.2345' }, { FSRQ: OLD_DATE, DWJZ: '1.2000' }] })
        }
    ]);

    const r = await fetchFundHistoryDetailed('001316', 5);
    assert.equal(r.source, 'eastmoney-lsjz');
    // lsjz 源是倒序 → 解析后应为升序
    assert.deepEqual(r.points.map(p => p.date), [OLD_DATE, '2024-01-03']);
    assert.equal(r.attempts[0].source, 'eastmoney-pingzhong');
});

test('基金历史：pingzhongdata 已是当日净值时提前结束', async () => {
    const today = beijingTodayStr();
    const ts = Date.parse(`${today}T12:00:00+08:00`);
    const calls = stubFetch([
        { match: 'pingzhongdata', response: textResponse(`var Data_ACWorthTrend = [[${ts},1.5]];`) }
    ]);

    const r = await fetchFundHistoryDetailed('001316', 5);
    assert.equal(r.source, 'eastmoney-pingzhong');
    assert.equal(r.points.length, 1);
    assert.equal(r.points[0].value, 1.5);
    assert.equal(r.attempts.length, 0);
    assert.equal(calls.filter(u => u.includes('lsjz')).length, 0, '不应再请求 lsjz');
});

test('基金历史：主源数据陈旧时会再试 lsjz 择优', async () => {
    stubFetch([
        {
            match: 'pingzhongdata',
            response: textResponse(`var Data_ACWorthTrend = [[${Date.parse('2024-01-02T12:00:00+08:00')},1.5]];`)
        },
        {
            match: 'lsjz',
            response: jsonResponse({ Data: { LSJZList: [{ FSRQ: OLD_DATE, DWJZ: '1.5' }] } })
        }
    ]);

    const r = await fetchFundHistoryDetailed('001316', 5);
    assert.equal(r.source, 'eastmoney-pingzhong'); // 日期相同 → 保留优先级更高的主源
    assert.equal(r.attempts.length, 1);
    assert.equal(r.attempts[0].source, 'eastmoney-lsjz');
});
