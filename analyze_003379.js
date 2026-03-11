import { queryAll } from './lib/storage/d1Client.js';

async function analyze() {
    console.log("Analyzing 003379...");
    const sql = `
        WITH RankedHistory AS (
            SELECT record_date, price, LAG(price) OVER (ORDER BY record_date ASC) as prev_price 
            FROM asset_history 
            WHERE code = '003379' AND type = 'fund'
        ) 
        SELECT record_date, price, prev_price, ((price - prev_price) / prev_price * 100) as daily_change 
        FROM RankedHistory 
        WHERE ABS((price - prev_price) / prev_price) > 0.02 
        ORDER BY record_date DESC`;

    const results = await queryAll(sql);
    console.log(`Found ${results.length} jumps > 2%`);
    results.forEach(r => {
        console.log(`${r.record_date}: ${r.prev_price} -> ${r.price} (${r.daily_change.toFixed(2)}%)`);
    });
}
analyze();
