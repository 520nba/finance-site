import puppeteer from 'puppeteer';

(async () => {
    try {
        console.log('Starting puppeteer to test production site (Cache Re-run)...');
        const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1536,1200'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1536, height: 1200 });

        const startTime = Date.now();
        const logTime = (msg) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[+${elapsed}s] ${msg}`);
        };

        logTime('Navigating to https://stock-tracker.sony-fans.workers.dev/ ...');
        await page.goto('https://stock-tracker.sony-fans.workers.dev/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        logTime('Waiting for login...');
        await page.waitForSelector('input[type="text"]', { timeout: 10000 });
        await page.type('input[type="text"]', 'derek');

        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const loginBtn = btns.find(b => b.textContent && b.textContent.includes('进入'));
            if (loginBtn) loginBtn.click();
        });

        let skeletonTime = 0;
        try {
            await page.waitForSelector('.glass-effect.p-4.lg\\:p-5', { timeout: 15000 });
            skeletonTime = (Date.now() - startTime) / 1000;
            logTime('✅ Skeleton (Names & Prices) loaded.');
        } catch (e) {
            logTime('❌ Timeout waiting for skeleton.');
        }

        // Click Fund tab
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const fundBtn = btns.find(b => b.textContent && b.textContent.includes('基金'));
            if (fundBtn) fundBtn.click();
        });

        logTime('Monitoring history data loading...');
        let fullyLoadedTime = 0;
        let previousLoadingCount = -1;

        while (Date.now() - startTime < 60000) {
            const loadingCount = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('.glass-effect'));
                let c = 0;
                for (let el of elements) {
                    if (el.textContent && el.textContent.includes('历史数据加载中')) c++;
                }
                return c;
            });

            const totalCards = await page.evaluate(() => document.querySelectorAll('.glass-effect.p-4.lg\\:p-5').length);

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

        console.log('\n--- PERFORMANCE SUMMARY ---');
        console.log(`Skeleton Load Time: ${skeletonTime > 0 ? skeletonTime.toFixed(2) + 's' : 'Failed'}`);
        console.log(`Full Data Load Time: ${fullyLoadedTime > 0 ? fullyLoadedTime.toFixed(2) + 's' : 'Timeout (>60s)'}`);
        console.log('---------------------------\n');

        await browser.close();
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    }
})();
