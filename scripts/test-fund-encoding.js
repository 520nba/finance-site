const fetch = require('node-fetch');

async function test() {
    let r = await fetch('https://fundgz.1234567.com.cn/js/110020.js?_=' + Date.now());
    let ab = await r.arrayBuffer();
    let textGbk = new (require('util').TextDecoder)('gbk').decode(ab);
    let matchGbk = textGbk.match(/"name":"([^"]+)"/);
    console.log('GBK:', matchGbk ? matchGbk[1] : 'no match');

    r = await fetch('https://fundgz.1234567.com.cn/js/110020.js?_=' + Date.now());
    let textUtf8 = await r.text();
    let matchUtf8 = textUtf8.match(/"name":"([^"]+)"/);
    console.log('UTF8:', matchUtf8 ? matchUtf8[1] : 'no match');
}
test();
