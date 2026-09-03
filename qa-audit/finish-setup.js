const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setViewport({ width: 1440, height: 900 });

  // Login
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
  await page.type('input[type="email"], input[name="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1000));

  // Visit verify-email link (in same authenticated session context isn't required, it's a token link)
  await page.goto('http://localhost:3001/verify-email?token=1db41c74f359e0cfbf7836008dd0e764d8e975a2f50fcc2988a579fd89e29fe0', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('verify page text:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
  await page.screenshot({ path: 'screenshots/setup-verify-email-result.png' });

  // Edit outlet to enable delivery+pickup
  await page.goto('http://localhost:3001/settings/outlets', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.click('button[aria-label], a[href*="outlets"]').catch(() => {});
  // click the pencil/edit icon in the row
  const editHref = await page.evaluate(() => {
    const pencil = document.querySelector('table tbody tr td button, table tbody tr a');
    return null;
  });
  // Click first icon button in the row (edit)
  await page.evaluate(() => {
    const row = document.querySelector('table tbody tr');
    const buttons = row.querySelectorAll('button');
    if (buttons[0]) buttons[0].click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('after edit click url:', page.url());
  await page.screenshot({ path: 'screenshots/setup-outlet-edit.png', fullPage: true });

  await browser.close();
})();
