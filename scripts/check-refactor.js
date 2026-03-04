const http = require('http');

async function testApis() {
    const rawCodes = "sh603348 sz002293 sh510880 sh600048 sh600585 sh510300 sz000333 sz000651 sh512660 sh512880 sh600036 sh513030 sh512010 sz159941 sh513800 sh513080 sz163001 sz162703 sz159605 sh510500 sz159687 sh518880 sz002216 sh600887 sz161005 sh513650 sz159612 sh601318 sz163417 sh600900";
    const codes = rawCodes.split(' ');

    // Test 1: Names
    const items = codes.map(c => ({ code: c, type: 'stock' }));

    console.log(`Testing with ${items.length} items...`);

    // 1. Names
    console.time("1. Names API");
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('http://localhost:3000/api/names/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, allowExternal: true })
        });
        const namesData = await res.json();
        console.log("Names Result:", Object.keys(namesData).length, "items fetched.");
        console.log("Sample Names:", [codes[0], codes[1]].map(c => namesData[`stock:${c}`]));
    } catch (e) { console.error("Names API Error:", e.message); }
    console.timeEnd("1. Names API");

    // 2. Quotes
    console.time("2. Quotes API");
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('http://localhost:3000/api/quotes/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, allowExternal: true })
        });
        const quotesData = await res.json();
        console.log("Quotes Result:", Object.keys(quotesData).length, "items fetched.");
        console.log("Sample Quotes:", [codes[0], codes[1]].map(c => quotesData[c]?.name));
    } catch (e) { console.error("Quotes API Error:", e.message); }
    console.timeEnd("2. Quotes API");

    // 3. History
    console.time("3. History API");
    try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('http://localhost:3000/api/history/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, allowExternal: true, days: 5 }) // just 5 days to be quick
        });
        const historyData = await res.json();
        console.log("History Result:", Object.keys(historyData).length, "items fetched.");
        console.log("Sample History Lengths:", [codes[0], codes[1]].map(c => historyData[`stock:${c}`]?.history?.length));
        console.log("Sample perf5d summary:", [codes[0], codes[1]].map(c => historyData[`stock:${c}`]?.summary?.perf5d));
    } catch (e) { console.error("History API Error:", e.message); }
    console.timeEnd("3. History API");
}

testApis();
