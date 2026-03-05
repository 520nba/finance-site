async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/intraday/bulk', {
            method: 'POST',
            body: JSON.stringify({ items: [{ code: '000001', type: 'stock' }], allowExternal: true }),
            headers: { 'Content-Type': 'application/json' }
        });
        const text = await res.text();
        console.log("RESPONSE:", text.substring(0, 500));
    } catch (e) {
        console.error("ERROR:", e);
    }
}
test();
