const puppeteer = require('puppeteer');

(async () => {
    try {
        console.log('Taking screenshots of streaming loading...');
        const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1536,1200'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1536, height: 1200 });

        await page.goto('http://localhost:3000');
        await page.evaluate(() => localStorage.clear());
        await page.reload();

        // Populate DB
        await page.evaluate(async () => {
            const userId = 'derek';
            const assets = [
                { code: '110011', type: 'fund' }, { code: '012348', type: 'fund' },
                { code: '161716', type: 'fund' }, { code: '024749', type: 'fund' },
                { code: '012831', type: 'fund' }, { code: '024423', type: 'fund' },
                { code: '025209', type: 'fund' }, { code: '002611', type: 'fund' },
                { code: '004253', type: 'fund' }, { code: '018439', type: 'fund' },
                { code: '018463', type: 'fund' }, { code: '110020', type: 'fund' },
            ];
            await fetch('/api/user/assets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, assets })
            });
            localStorage.setItem('tracker_user_id', 'derek');
        });

        console.log('Reloading to simulate real user load...');
        await page.reload();

        // Switch to Fund tab immediately to see the stream
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const fundBtn = btns.find(b => b.textContent && b.textContent.includes('基金'));
            if (fundBtn) fundBtn.click();
        });

        console.log('Taking screenshot at 300ms (Core Loaded)...');
        await new Promise(r => setTimeout(r, 300));
        await page.screenshot({ path: 'stream-1-skeleton.png', fullPage: true });

        console.log('Taking screenshot at 3s (Partially Loaded)...');
        await new Promise(r => setTimeout(r, 2700));
        await page.screenshot({ path: 'stream-2-partial.png', fullPage: true });

        console.log('Taking screenshot at 8s (More Loaded)...');
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'stream-3-more.png', fullPage: true });

        console.log('Taking screenshot at 15s (Fully Loaded)...');
        await new Promise(r => setTimeout(r, 7000));
        await page.screenshot({ path: 'stream-4-full.png', fullPage: true });

        await browser.close();
        console.log('Success.');
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
