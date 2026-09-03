const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
  await page.type('input[type="email"], input[name="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1000));

  await page.goto('http://localhost:3001/settings/business/information', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  // Click "Resend email"
  const resendClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Resend email');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('resend clicked:', resendClicked);
  await new Promise((r) => setTimeout(r, 2000));

  // Now go enable delivery on outlet
  await page.goto('http://localhost:3001/settings/outlets', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshots/setup-outlets.png', fullPage: true });

  await browser.close();
})();
