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

  // Click "Pickup" side nav item
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('div, a, button'));
    const pickupNav = items.find((el) => el.textContent.trim().startsWith('Pickup') && el.querySelector === undefined ? false : true);
  });
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('aside *, nav *, div'));
    const el = candidates.find((e) => e.children.length === 0 && e.textContent.trim() === 'Pickup');
    if (el) { (el.closest('a') || el.closest('button') || el.parentElement).click(); return true; }
    return false;
  });
  console.log('pickup nav clicked', clicked);
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: 'screenshots/setup-pickup-tab.png', fullPage: true });

  // enable pickup toggle if present (first switch on this panel)
  const togglesInfo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button[role="switch"]')).map((b) => b.getAttribute('aria-checked')),
  );
  console.log('toggles on pickup tab:', togglesInfo);

  await browser.close();
})();
