
import { fetchFundHistory } from './lib/services/historyFetcher.js';

async function verify() {
    const code = '003379';
    const history = await fetchFundHistory(code, 250);
    if (!history) return console.log("Fetch failed");

    // Check for jumps > 10%
    const jumps = history.filter((h, i) => i > 0 && Math.abs((h.value - history[i - 1].value) / history[i - 1].value) > 0.05);
    if (jumps.length > 0) {
        console.log("Found spikes > 5%:");
        jumps.forEach(j => console.log(`${j.date}: ${j.value}`));
    } else {
        console.log("No spikes > 5% found in source data.");
    }
}
verify();
