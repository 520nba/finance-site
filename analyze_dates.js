
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('002920_all_dates.json', 'utf8'));
const dates = data[0].results.map(r => r.record_date);
console.log("Count:", dates.length);
console.log("Oldest:", dates[0]);
console.log("Newest:", dates[dates.length - 1]);
