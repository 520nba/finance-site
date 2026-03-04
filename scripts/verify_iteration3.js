// Node 20 has built-in fetch
async function verify() {
    const baseUrl = 'http://localhost:3000';
    const testItems = [
        { code: 'sh600036', type: 'stock' },
        { code: 'sz000001', type: 'stock' }
    ];

    console.log('--- Iteration 3 Integration Verification ---');

    // 1. Test Quotes Envelope & Data
    try {
        const res = await fetch(`${baseUrl}/api/quotes/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: testItems, allowExternal: true })
        });
        const json = await res.json();
        console.log('Quotes API Status:', res.status);
        console.log('Quotes Success:', json.success);
        if (json.success) {
            console.log('Quotes Data keys:', Object.keys(json.data));
            if (json.data['sh600036']) console.log('Sample Price (sh600036):', json.data['sh600036'].price);
        } else {
            console.error('Quotes Error:', json.error);
        }
    } catch (e) { console.error('Quotes API Failed:', e.message); }

    // 2. Test History Envelope & Data
    try {
        const res = await fetch(`${baseUrl}/api/history/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: testItems, allowExternal: true, days: 5 })
        });
        const json = await res.json();
        console.log('\nHistory API Status:', res.status);
        console.log('History Success:', json.success);
        if (json.success) {
            console.log('History Data keys:', Object.keys(json.data));
            const key = 'stock:sh600036';
            if (json.data[key]) console.log('Sample History Length:', json.data[key].history?.length);
        }
    } catch (e) { console.error('History API Failed:', e.message); }

    // 3. Test User Assets (Requires no userId or a mock one)
    try {
        const userId = 'verify_test_user';
        const res = await fetch(`${baseUrl}/api/user/assets?userId=${userId}`);
        const json = await res.json();
        console.log('\nUser Assets GET Status:', res.status);
        // User assets API returns array directly or envelope? 
        // In Iteration 2 we changed it to envelope!
        console.log('User Assets Success:', json.success);
        if (json.success) {
            console.log('User Assets Data Type:', Array.isArray(json.data) ? 'Array' : typeof json.data);
        }
    } catch (e) { console.error('User Assets API Failed:', e.message); }

    console.log('\nVerification complete.');
}

verify();
