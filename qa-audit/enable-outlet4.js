const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
  await page.type('input[type="email"], input[name="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1000));

  await page.goto('http://localhost:3001/settings/outlets/1/edit', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));

  const btnTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim().slice(0, 40)),
  );
  console.log('buttons:', JSON.stringify(btnTexts, null, 2));

  await browser.close();
})();
