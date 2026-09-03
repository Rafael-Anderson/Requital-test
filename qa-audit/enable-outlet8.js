const puppeteer = require('puppeteer');
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function clickByText(page, selector, text) {
  return page.evaluate((sel, t) => {
    const el = Array.from(document.querySelectorAll(sel)).find((e) => e.textContent.trim().startsWith(t));
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);
}
async function toggleByLabel(page, labelText) {
  return page.evaluate((label) => {
    const labelEl = Array.from(document.querySelectorAll('span,p,label,div')).find(
      (e) => e.children.length === 0 && e.textContent.trim() === label,
    );
    if (!labelEl) return 'NO_LABEL';
    let row = labelEl.parentElement;
    let target = null;
    for (let i = 0; i < 4 && row && !target; i++) {
      target = row.querySelector('button[role="switch"]');
      row = row.parentElement;
    }
    if (!target) return 'NO_SWITCH';
    const before = target.getAttribute('aria-checked');
    target.click();
    return 'clicked, before=' + before;
  }, labelText);
}
async function login(page) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
    await delay(800);
    await page.click('input[type="email"]', { clickCount: 3 });
    await page.type('input[type="email"]', 'admin@test-shop.com');
    await page.type('input[type="password"]', 'dev-password-123');
    await page.click('button[type="submit"]');
    await delay(2500);
    if (!page.url().includes('/login')) return true;
    console.log(`login attempt ${attempt} failed, url=${page.url()}`);
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setViewport({ width: 1440, height: 900 });

  if (!(await login(page))) { console.log('LOGIN FAILED ENTIRELY'); await browser.close(); return; }
  console.log('logged in');

  for (let i = 0; i < 5; i++) {
    await page.goto('http://localhost:3001/settings/outlets/1/edit', { waitUntil: 'networkidle2' });
    await delay(1000);
    if (!page.url().includes('/login')) break;
    await login(page);
  }
  console.log('edit page url', page.url());

  console.log('Pickup tab click:', await clickByText(page, 'button', 'PickupIn-store'));
  await delay(600);
  console.log('toggle Pickup available:', await toggleByLabel(page, 'Pickup available'));
  await delay(400);
  console.log('save pickup (top):', await clickByText(page, 'button', 'Save changes'));
  await delay(2000);
  await page.screenshot({ path: 'screenshots/setup-pickup-final.png', fullPage: true });

  console.log('Delivery tab click:', await clickByText(page, 'button', 'DeliveryRadius'));
  await delay(600);
  console.log('toggle Delivery available:', await toggleByLabel(page, 'Delivery available'));
  await delay(400);
  await page.screenshot({ path: 'screenshots/setup-delivery-tab-raw2.png', fullPage: true });
  console.log('save delivery (top):', await clickByText(page, 'button', 'Save changes'));
  await delay(2000);
  await page.screenshot({ path: 'screenshots/setup-delivery-final.png', fullPage: true });

  await browser.close();
})();
