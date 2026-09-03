const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('title:', await page.title());
  await page.screenshot({ path: 'screenshots/smoke-admin-login.png' });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
