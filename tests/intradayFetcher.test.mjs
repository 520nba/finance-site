/**
 * tests/intradayFetcher.test.mjs
 *
 * 分时多源解析回归测试
 *   离线部分：node --test tests/
 *   联网部分（校验 27 只自选股各源可达性）：INTRADAY_LIVE=1 node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    toHHMM,
    parseEastmoneyTrends,
    parseTencentMinute,
    fetchIntradaySnapshot,
    fetchEastmoneyIntraday,
    fetchTencentIntraday
} from '../lib/services/intradayFetcher.js';

const WATCHLIST = [
    'sh510300', 'sh510500', 'sh510880', 'sh512010', 'sh512660', 'sh512880',
    'sh513030', 'sh513080', 'sh513650', 'sh513800', 'sh518880', 'sh600036',
    'sh600048', 'sh600585', 'sh600887', 'sh600900', 'sh601318', 'sh603348',
    'sz000333', 'sz000651', 'sz002216', 'sz002293', 'sz159605', 'sz159612',
    'sz159687', 'sz159941', 'sz161005'
];

test('toHHMM 归一化各种时间写法', () => {
    assert.equal(toHHMM('2026-10-12 09:30'), '09:30');
    assert.equal(toHHMM('0930'), '09:30');
    assert.equal(toHHMM('9:30'), '09:30');
    assert.equal(toHHMM('15:00'), '15:00');
    assert.equal(toHHMM(''), null);
    assert.equal(toHHMM(null), null);
});

test('parseEastmoneyTrends 解析趋势行并剔除 0 价', () => {
    const json = {
        data: {
            preClose: 52.83,
            trends: [
                '2026-10-12 09:15,52.80,52.86,52.90,52.80,100,1000,52.85',
                '2026-10-12 09:16,52.86,52.90,52.90,52.86,200,2000,52.88',
                '2026-10-12 09:17,52.90,0.00,52.90,52.90,0,0,52.90'
            ]
        }
    };
    const r = parseEastmoneyTrends(json);
    assert.equal(r.points.length, 2);
    assert.deepEqual(r.points[0], { time: '09:15', value: 52.86 });
    assert.equal(r.prevClose, 52.83);
    assert.equal(r.date, '2026-10-12');
});

test('parseEastmoneyTrends 空数据返回 null', () => {
    assert.equal(parseEastmoneyTrends({ data: { trends: [] } }), null);
    assert.equal(parseEastmoneyTrends(null), null);
});

test('parseTencentMinute 解析分钟线并过滤盘后快照', () => {
    const json = {
        code: 0,
        data: {
            sh601318: {
                data: {
                    date: '20261012',
                    data: [
                        '0930 52.86 3285 17364510.00',
                        '1130 52.92 295143 1567494775.15',
                        '1300 52.92 295143 1567494775.15',
                        '1500 53.24 560870 2973253019.59',
                        '1530 53.24 560870 2973253019.59'
                    ]
                },
                qt: { sh601318: ['1', '中国平安', '601318', '53.24', '52.83'] }
            }
        }
    };
    const r = parseTencentMinute(json, 'sh601318');
    assert.equal(r.date, '2026-10-12');
    assert.equal(r.prevClose, 52.83);
    // 1500 保留、1530 盘后快照被丢弃
    assert.deepEqual(r.points.map(p => p.time), ['09:30', '11:30', '13:00', '15:00']);
});

test('parseTencentMinute 缺字段时返回 null', () => {
    assert.equal(parseTencentMinute({ data: {} }, 'sh601318'), null);
    assert.equal(parseTencentMinute(null, 'sh601318'), null);
});

test('fetchIntradaySnapshot: 跨日脏数据必须被丢弃', async () => {
    // 期望交易日设为 1999-01-01，任何真实源返回的当日数据都应被判定为 stale
    const { data, errors } = await fetchIntradaySnapshot('sh601318', null, '1999-01-01');
    if (data === null && errors.length === 0) return; // 离线环境，跳过
    assert.equal(data, null);
    assert.ok(errors.every(e => /stale date|HTTP|fetch|non-JSON|empty/.test(e)), errors.join(' | '));
});

test('联网：27 只自选股每个源的可达性', { skip: process.env.INTRADAY_LIVE !== '1' }, async () => {
    const summary = [];
    for (const code of WATCHLIST) {
        const { data, errors } = await fetchIntradaySnapshot(code);
        summary.push({
            code,
            ok: !!data,
            source: data?.source ?? '-',
            points: data?.points?.length ?? 0,
            last: data?.points?.at(-1)?.time ?? '-',
            errors: errors.join(' | ')
        });
    }
    const failed = summary.filter(s => !s.ok);
    console.table(summary);
    assert.equal(failed.length, 0, `以下代码所有源都失败: ${JSON.stringify(failed)}`);
});

// 生产环境东财被 Cloudflare 出口拦截，腾讯是唯一可用源，
// 因此必须单独确认腾讯对全部自选股都返回数据。
test('联网：腾讯分钟线覆盖全部自选股', { skip: process.env.INTRADAY_LIVE !== '1' }, async () => {
    const failed = [];
    for (const code of WATCHLIST) {
        try {
            const d = await fetchTencentIntraday(code);
            if (!d?.points?.length) failed.push(`${code}: empty`);
        } catch (e) {
            failed.push(`${code}: ${e.message}`);
        }
    }
    assert.deepEqual(failed, [], `腾讯源失败: ${failed.join(', ')}`);
});

// 东财对高频服务端抓取会限流/封 IP（连续 27 次后基本全挂），
// 因此这里只做信息性观测，不作为断言条件。
test('联网：东财 trends2 覆盖情况（仅观测，东财会限流）', { skip: process.env.INTRADAY_LIVE !== '1' }, async (t) => {
    const failed = [];
    for (const code of WATCHLIST) {
        try {
            const d = await fetchEastmoneyIntraday(code);
            if (!d?.points?.length) failed.push(`${code}: empty`);
        } catch (e) {
            failed.push(`${code}: ${e.message}`);
        }
    }
    t.diagnostic(`东财失败 ${failed.length}/${WATCHLIST.length}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ' ...' : ''}`);
});
