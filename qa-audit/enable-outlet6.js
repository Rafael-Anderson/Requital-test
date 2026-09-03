const puppeteer = require('puppeteer');

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function clickByText(page, selector, text) {
  return page.evaluate((sel, t) => {
    const el = Array.from(document.querySelectorAll(sel)).find((e) => e.textContent.trim().startsWith(t));
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);
}

async function login(page) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
    await delay(500);
    await page.evaluate(() => { document.querySelector('input[type="email"]').value = ''; });
    await page.type('input[type="email"]', 'admin@test-shop.com');
    await page.type('input[type="password"]', 'dev-password-123');
    await page.click('button[type="submit"]');
    await delay(2500);
    const token = await page.evaluate(() => localStorage.getItem('requital_admin_token') || localStorage.getItem('token') || Object.keys(localStorage).join(','));
    console.log(`login attempt ${attempt}, url=${page.url()}, localStorageKeys=${token}`);
    if (!page.url().includes('/login')) return true;
    await delay(1500);
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('3000')) console.log('[http]', r.status(), r.url()); });
  await page.setViewport({ width: 1440, height: 900 });

  const ok = await login(page);
  console.log('login ok:', ok);
  if (!ok) { await browser.close(); return; }

  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.goto('http://localhost:3001/settings/outlets/1/edit', { waitUntil: 'networkidle2' });
    await delay(1200);
    if (!page.url().includes('/login')) break;
    console.log('redirected to login, retry login attempt', attempt);
    await login(page);
  }
  console.log('final url:', page.url());

  console.log('click Pickup tab:', await clickByText(page, 'button', 'PickupIn-store'));
  await delay(800);
  const pickupToggleState = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return sw ? sw.getAttribute('aria-checked') : 'NONE';
  });
  console.log('pickup toggle before:', pickupToggleState);
  if (pickupToggleState === 'false') {
    await page.click('button[role="switch"]');
    await delay(500);
  }
  await page.screenshot({ path: 'screenshots/setup-pickup-panel2.png', fullPage: true });
  console.log('click Save:', await clickByText(page, 'button', 'Save changes'));
  await delay(2000);

  console.log('click Delivery tab:', await clickByText(page, 'button', 'DeliveryRadius'));
  await delay(800);
  const deliveryToggleState = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return sw ? sw.getAttribute('aria-checked') : 'NONE';
  });
  console.log('delivery toggle before:', deliveryToggleState);
  if (deliveryToggleState === 'false') {
    await page.click('button[role="switch"]');
    await delay(500);
  }
  await page.screenshot({ path: 'screenshots/setup-delivery-panel2.png', fullPage: true });
  console.log('click Save 2:', await clickByText(page, 'button', 'Save changes'));
  await delay(2000);
  await page.screenshot({ path: 'screenshots/setup-delivery-saved2.png', fullPage: true });

  await browser.close();
})();
