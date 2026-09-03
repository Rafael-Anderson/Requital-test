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

  await page.goto('http://localhost:3001/settings/outlets', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));

  const href = await page.evaluate(() => document.querySelector('table tbody tr a').getAttribute('href'));
  console.log('edit href', href);
  await page.goto('http://localhost:3001' + href, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshots/setup-outlet-edit-page.png', fullPage: true });

  const toggles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button[role="switch"]')).map((b, i) => ({
      i,
      checked: b.getAttribute('aria-checked'),
      nearbyText: b.closest('div')?.parentElement?.textContent?.slice(0, 80),
    })),
  );
  console.log('toggles:', JSON.stringify(toggles, null, 2));

  await browser.close();
})();
