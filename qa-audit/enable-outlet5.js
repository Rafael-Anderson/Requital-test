const puppeteer = require('puppeteer');

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function clickByText(page, selector, text) {
  return page.evaluate((sel, t) => {
    const el = Array.from(document.querySelectorAll(sel)).find((e) => e.textContent.trim().startsWith(t));
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);
}

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
  await delay(1000);

  await page.goto('http://localhost:3001/settings/outlets/1/edit', { waitUntil: 'networkidle2' });
  await delay(1200);

  console.log('click Pickup tab:', await clickByText(page, 'button', 'PickupIn-store'));
  await delay(800);
  await page.screenshot({ path: 'screenshots/setup-pickup-panel.png', fullPage: true });

  // Find and enable the first switch on this panel (assume it's "Pickup enabled" style toggle)
  const pickupToggleState = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return sw ? sw.getAttribute('aria-checked') : 'NONE';
  });
  console.log('pickup toggle before:', pickupToggleState);
  if (pickupToggleState === 'false') {
    await page.click('button[role="switch"]');
    await delay(500);
  }
  console.log('click Save (bottom):', await clickByText(page, 'button', 'Save changes'));
  await delay(1500);
  await page.screenshot({ path: 'screenshots/setup-pickup-saved.png', fullPage: true });

  // Now Delivery tab
  console.log('click Delivery tab:', await clickByText(page, 'button', 'DeliveryRadius'));
  await delay(800);
  await page.screenshot({ path: 'screenshots/setup-delivery-panel.png', fullPage: true });
  const deliveryToggleState = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return sw ? sw.getAttribute('aria-checked') : 'NONE';
  });
  console.log('delivery toggle before:', deliveryToggleState);
  if (deliveryToggleState === 'false') {
    await page.click('button[role="switch"]');
    await delay(500);
  }
  await page.screenshot({ path: 'screenshots/setup-delivery-panel-after-toggle.png', fullPage: true });
  console.log('click Save (bottom) 2:', await clickByText(page, 'button', 'Save changes'));
  await delay(1500);
  await page.screenshot({ path: 'screenshots/setup-delivery-saved.png', fullPage: true });

  await browser.close();
})();
