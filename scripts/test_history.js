async function test() {
    const res = await fetch('http://localhost:3000/api/history/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items: [{ code: 'sh600022', type: 'stock' }],
            days: 5,
            allowExternal: true
        })
    });
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
}

test();
