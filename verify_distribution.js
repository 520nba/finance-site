
import { queryAll } from './lib/storage/d1Client.js';

async function verify() {
    const code = '003379';
    const rows = await queryAll("SELECT (price > 1.4) as is_high, MIN(record_date) as min_d, MAX(record_date) as max_d, COUNT(*) as count FROM asset_history WHERE code = ? GROUP BY is_high", [code]);
    console.log(JSON.stringify(rows, null, 2));
}
verify();
