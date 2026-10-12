/**
 * tests/marketParsers.test.mjs
 *
 * 多源解析回归测试（离线）
 *   node --test tests/marketParsers.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseTencentQuotes,
    parseSinaQuotes,
    parseTencentStockName,
    parseFundLsjz,
    parseFundPingzhongJs
} from '../lib/services/marketParsers.js';

test('parseTencentQuotes 解析批量行情', () => {
    // 精简但字段位置真实的腾讯响应
    const fields = new Array(33).fill('0');
    fields[0] = '1';
    fields[1] = '中国平安';
    fields[2] = '601318';
    fields[3] = '53.24';
    fields[4] = '52.83';
    fields[31] = '0.41';
    fields[32] = '0.78';
    const text = `v_sh601318="${fields.join('~')}";`;

    const r = parseTencentQuotes(text);
    assert.deepEqual(Object.keys(r), ['sh601318']);
    assert.equal(r.sh601318.name, '中国平安');
    assert.equal(r.sh601318.price, 53.24);
    assert.equal(r.sh601318.prevClose, 52.83);
    assert.equal(r.sh601318.changePercent, 0.78);
});

test('parseTencentQuotes 字段不足时跳过', () => {
    assert.deepEqual(parseTencentQuotes('v_sh601318="1~中国平安~601318";'), {});
    assert.deepEqual(parseTencentQuotes(''), {});
});

test('parseSinaQuotes 解析新浪行情并计算涨跌', () => {
    const text = 'var hq_str_sh601318="中国平安,52.830,52.860,53.240,53.300,52.800,53.230,53.240,1,2,3";\n'
        + 'var hq_str_sz000333="美的集团,82.500,82.460,83.500,83.900,82.100,83.490,83.500,1,2,3";';
    const r = parseSinaQuotes(text);
    assert.equal(Object.keys(r).length, 2);
    assert.equal(r.sh601318.price, 53.24);
    assert.equal(r.sh601318.prevClose, 52.86);
    assert.equal(r.sh601318.changePercent, Number(((53.24 / 52.86 - 1) * 100).toFixed(2)));
    assert.equal(r.sz000333.name, '美的集团');
});

test('parseSinaQuotes 价格为 0 或字段不足时跳过', () => {
    assert.deepEqual(parseSinaQuotes('var hq_str_sh601318="中国平安,0,0,0";'), {});
    assert.deepEqual(parseSinaQuotes('var hq_str_sh601318="中国平安";'), {});
});

test('parseTencentStockName 取名称字段', () => {
    assert.equal(parseTencentStockName('v_sh600519="1~贵州茅台~600519~1500.00~";'), '贵州茅台');
    assert.equal(parseTencentStockName('v_sh600519="1~~600519~";'), null);
    assert.equal(parseTencentStockName(''), null);
});

test('parseFundLsjz 解析并反转为升序', () => {
    const json = {
        Data: [
            { FSRQ: '2026-10-09', DWJZ: '1.8301' },
            { FSRQ: '2026-10-08', DWJZ: '1.8280' },
            { FSRQ: '2026-09-30', DWJZ: '1.8100' }
        ]
    };
    const r = parseFundLsjz(json);
    assert.deepEqual(r.map(p => p.date), ['2026-09-30', '2026-10-08', '2026-10-09']);
    assert.equal(r[2].value, 1.8301);
});

test('parseFundLsjz 空/异常输入返回空数组', () => {
    assert.deepEqual(parseFundLsjz({}), []);
    assert.deepEqual(parseFundLsjz(null), []);
});

test('parseFundPingzhongJs 兼容数组与对象两种格式', () => {
    const arr = 'x/**/var Data_ACWorthTrend = [[1791792000000,1.83],[1791705600000,1.82]];/*end*/ var y=1;';
    const a = parseFundPingzhongJs(arr);
    assert.equal(a.length, 2);
    assert.deepEqual(a[0], { ts: 1791792000000, val: 1.83 });

    const obj = 'var Data_netWorthTrend = [{"x":1791792000000,"y":1.83}];';
    const b = parseFundPingzhongJs(obj);
    assert.deepEqual(b, [{ ts: 1791792000000, val: 1.83 }]);
});

test('parseFundPingzhongJs 缺变量或坏 JSON 返回 null', () => {
    assert.equal(parseFundPingzhongJs('var Nothing = 1;'), null);
    assert.equal(parseFundPingzhongJs('var Data_ACWorthTrend = [[1,;'), null);
});
