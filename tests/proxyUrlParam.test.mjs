/**
 * tests/proxyUrlParam.test.mjs
 *
 * 代理解析 URL 传参的编解码回归测试（离线，纯函数）
 *   node --test tests/proxyUrlParam.test.mjs
 *
 * 覆盖：多查询参数（含 & = %）、中文、超长 URL、非法输入、往返一致性。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeUrlParam, decodeUrlParam } from '../lib/proxy/urlParam.js';

test('往返：含多个 & 的东财 API URL 不丢参数', () => {
    const url = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=1.600036&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
    const encoded = encodeUrlParam(url);

    // base64url 里不得出现会导致查询串被截断的字符
    assert.ok(!/[%&=+/]/.test(encoded), `encoded 含危险字符: ${encoded}`);
    assert.equal(decodeUrlParam(encoded), url);
});

test('往返：中文与特殊字符', () => {
    const url = 'https://fund.eastmoney.com/pingzhongdata/001316.js?name=安信稳健&tag=a b';
    assert.equal(decodeUrlParam(encodeUrlParam(url)), url);
});

test('往返：超长 URL（1000 个参数）', () => {
    const url = 'https://push2.eastmoney.com/x?' + Array.from({ length: 1000 }, (_, i) => `k${i}=v${i}`).join('&');
    assert.equal(decodeUrlParam(encodeUrlParam(url)), url);
});

test('encode 对非字符串返回空串', () => {
    assert.equal(encodeUrlParam(null), '');
    assert.equal(encodeUrlParam(123), '');
});

test('decode 对非法输入返回空串而不是抛错', () => {
    assert.equal(decodeUrlParam(''), '');
    assert.equal(decodeUrlParam(null), '');
    // atob 对非法字符会抛错 → 必须被吞掉
    assert.equal(decodeUrlParam('!!!!'), '');
});

test('decode 兼容带 padding 的标准 base64（人工调用时的宽松处理）', () => {
    const url = 'https://a.example/b?c=1&d=2';
    const std = Buffer.from(url, 'utf8').toString('base64'); // 含 + / = 的标准 base64
    assert.equal(decodeUrlParam(std), url);
});
