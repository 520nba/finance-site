import puppeteer from 'puppeteer';
import { setTimeout } from 'timers/promises';

(async () => {
    console.log('Starting puppeteer...');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1536,1200'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1536, height: 1200 });

    console.log('Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000');

    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.waitForSelector('input[placeholder="Enter User ID"]', { timeout: 10000 });
    await page.type('input[placeholder="Enter User ID"]', 'test-stream-bot');
    await page.click('button ::-p-text(进入)');

    await setTimeout(2000);
    // Switch to Funds
    const tabs = await page.$$('button');
    for (const tab of tabs) {
        const text = await page.evaluate(el => el.textContent, tab);
        if (text.includes('基金')) {
            await tab.click();
            break;
        }
    }
    await setTimeout(500);

    // Open Batch Add
    console.log('Adding 20 funds...');
    await page.click('button[title="批量添加"]');
    await setTimeout(500);

    const fundsList = [
        '000001', '012348', '024749', '110011', '161716',
        '510300', '512880', '002611', '004253', '012831',
        '018439', '018463', '025209', '110020', '024423',
        '600028', '600036', '000858', '600519', '002594'
    ].join(',');

    await page.type('textarea', fundsList);
    await page.click('button ::-p-text(开始添加)');

    console.log('Waiting 15s for full sync...');
    await setTimeout(15000);

    console.log('Reloading to test streaming load...');
    await page.reload();

    console.log('Taking screenshot at t=1s...');
    await setTimeout(1000);
    await page.screenshot({ path: 'local-streaming-reload-1s.png', fullPage: true });

    console.log('Taking screenshot at t=5s...');
    await setTimeout(4000);
    await page.screenshot({ path: 'local-streaming-reload-5s.png', fullPage: true });

    console.log('Taking screenshot at t=12s...');
    await setTimeout(7000);
    await page.screenshot({ path: 'local-streaming-reload-12s.png', fullPage: true });

    console.log('Taking screenshot at t=20s...');
    await setTimeout(8000);
    await page.screenshot({ path: 'local-streaming-reload-20s.png', fullPage: true });

    console.log('Done.');
    await browser.close();
})();
