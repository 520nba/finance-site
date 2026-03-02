import puppeteer from 'puppeteer';

(async () => {
    try {
        console.log('Starting puppeteer to test production site...');
        const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1536,1200'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1536, height: 1200 });

        // Helper to log with timestamp
        const startTime = Date.now();
        const logTime = (msg) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[+${elapsed}s] ${msg}`);
        };

        logTime('Navigating to https://stock-tracker.sony-fans.workers.dev/ ...');
        await page.goto('https://stock-tracker.sony-fans.workers.dev/');

        // Ensure clean state
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        logTime('Waiting for login input...');
        await page.waitForSelector('input[placeholder="Enter User ID"]', { timeout: 10000 });
        await page.type('input[placeholder="Enter User ID"]', 'derek');

        logTime('Clicking login...');
        await page.click('button ::-p-text(进入)');

        // Wait for the skeleton to appear (assets state populated)
        // We know it's loaded when the "股票" or "基金" text is visible on the tabs, or asset cards appear.
        let skeletonTime = 0;
        try {
            await page.waitForSelector('.glass-effect.p-4.lg\\:p-5', { timeout: 10000 });
            skeletonTime = (Date.now() - startTime) / 1000;
            logTime('✅ Skeleton (Names & Prices) loaded.');
        } catch (e) {
            logTime('❌ Timeout waiting for skeleton.');
        }

        // Switch to Funds tab since Derek has many funds
        const tabs = await page.$$('button');
        for (const tab of tabs) {
            const text = await page.evaluate(el => el.textContent, tab);
            if (text.includes('基金')) {
                await tab.click();
                break;
            }
        }

        logTime('Monitoring history data loading...');

        // Polling to see how many "历史数据加载中" are left
        let fullyLoadedTime = 0;
        let previousLoadingCount = -1;

        while (Date.now() - startTime < 60000) { // Max wait 60 seconds
            const loadingCount = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                return elements.filter(el => el.textContent === '历史数据加载中...').length;
            });

            const totalCards = await page.evaluate(() => {
                return document.querySelectorAll('.glass-effect.p-4.lg\\:p-5').length;
            });

            if (loadingCount !== previousLoadingCount) {
                logTime(`Status: ${totalCards - loadingCount} / ${totalCards} cards have chart data. (${loadingCount} still loading)`);
                previousLoadingCount = loadingCount;
            }

            if (loadingCount === 0 && totalCards > 0) {
                fullyLoadedTime = (Date.now() - startTime) / 1000;
                logTime('✅ All history data fully loaded!');
                break;
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        if (fullyLoadedTime === 0) {
            logTime('⚠️ Timeout: Not all data loaded within 60 seconds.');
        }

        console.log('\n--- PERFORMANCE SUMMARY ---');
        console.log(`Skeleton Load Time: ${skeletonTime > 0 ? skeletonTime.toFixed(2) + 's' : 'Failed'}`);
        console.log(`Full Data Load Time: ${fullyLoadedTime > 0 ? fullyLoadedTime.toFixed(2) + 's' : 'Timeout (>60s)'}`);
        console.log('---------------------------\n');

        await browser.close();
        console.log('Done.');
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    }
})();
