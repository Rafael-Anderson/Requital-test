const puppeteer = require('puppeteer');
const path = require('path');
const PROFILE = path.join(__dirname, 'chrome-profile');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', userDataDir: PROFILE });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 200)); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/orders/draft-orders', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: 'screenshots/_seed-draftlist2.png', fullPage: true });
  console.log('url:', page.url());

  const link = await page.$('a[href*="/orders/draft-orders/"]');
  console.log('found draft link:', !!link);
  if (!link) {
    console.log('body:', (await page.evaluate(() => document.body.innerText)).slice(0, 400));
    await browser.close();
    return;
  }
  await link.click();
  await new Promise((r) => setTimeout(r, 1200));
  console.log('detail url:', page.url());
  await page.screenshot({ path: 'screenshots/_seed-draftdetail2.png', fullPage: true });

  const completeClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /^complete$/i.test(b.textContent.trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('complete clicked:', completeClicked);
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: 'screenshots/_seed-draftcompleted2.png', fullPage: true });
  console.log('post-complete body:', (await page.evaluate(() => document.body.innerText)).slice(0, 400));

  await browser.close();
})();
