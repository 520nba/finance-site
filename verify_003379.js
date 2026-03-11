
import { fetchFundHistory } from './lib/services/historyFetcher.js';

async function test() {
    const code = '003379';
    console.log(`Checking ${code}...`);
    const history = await fetchFundHistory(code, 250);
    if (!history) {
        console.log("Failed to fetch.");
        return;
    }

    console.log(`Fetched ${history.length} points.`);
    let anomalies = [];
    for (let i = 1; i < history.length; i++) {
        const change = Math.abs((history[i].value - history[i - 1].value) / history[i - 1].value * 100);
        if (change > 5) {
            anomalies.push({
                date: history[i].date,
                prev: history[i - 1].value,
                curr: history[i].value,
                delta: change.toFixed(2) + '%'
            });
        }
    }

    if (anomalies.length > 0) {
        console.log("Significant fluctuations found (>5%):");
        console.table(anomalies);
    } else {
        console.log("No daily fluctuations > 5% found in the last 250 days.");
    }

    const max = Math.max(...history.map(h => h.value));
    const min = Math.min(...history.map(h => h.value));
    console.log(`Range: ${min} - ${max} (Swing: ${((max - min) / min * 100).toFixed(2)}%)`);
}

test();
