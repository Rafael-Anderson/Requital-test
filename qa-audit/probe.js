const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 3000));
  await page.goto('http://localhost:3001/theme', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const links = await page.$$eval('a', (as) => as.map((a) => a.href).filter((h) => h.includes('/theme/')));
  console.log('LINKS:', links);
  await browser.close();
})();
