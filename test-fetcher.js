
import { fetchFundHistory } from './lib/services/historyFetcher.js';

async function test() {
    console.log('--- Testing Fund History Fetcher (Bulk JS Endpoint) ---');

    // 测试基金：易方达沪深300ETF联接A (110020)
    const fundCode = '110020';
    const days = 10;

    console.log(`Target Fund: ${fundCode}, Days: ${days}`);

    try {
        const data = await fetchFundHistory(fundCode, days);

        if (data && Array.isArray(data)) {
            console.log('SUCCESS!');
            console.log(`Fetched ${data.length} points.`);
            console.log('Last 3 points:', JSON.stringify(data.slice(-3), null, 2));

            if (data.length > 0) {
                const lastPoint = data[data.length - 1];
                if (lastPoint.date && typeof lastPoint.value === 'number') {
                    console.log('Data format is CORRECT.');
                } else {
                    console.error('Data format is INVALID!');
                }
            }
        } else {
            console.error('FAILED: No data returned or data is not an array.');
        }
    } catch (e) {
        console.error('ERROR during testing:', e.message);
    }
}

test();
