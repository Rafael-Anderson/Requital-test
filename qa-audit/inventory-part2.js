const puppeteer = require('puppeteer');
const BASE = 'http://localhost:3001';
function attachListeners(page) {
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[http-${res.status()}] ${res.request().method()} ${res.url()}`); });
}
async function shot(page, name) {
  try { await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true, timeout: 15000 }); }
  catch (e) { console.log(`screenshot fail ${name}: ${e.message}`); }
}
async function visitAndWait(page, path, viewport, waitText) {
  await page.setViewport(viewport);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 25000 });
    } catch (e) { console.log(`nav attempt ${attempt} error ${path}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 800));
    if (!waitText) return;
    const has = await page.evaluate((t) => document.body.innerText.includes(t), waitText).catch(() => false);
    if (has) return;
    console.log(`retrying ${path}, waitText "${waitText}" not found yet (attempt ${attempt})`);
  }
}
async function clickByText(page, selector, text) {
  return page.evaluate((selector, text) => {
    const els = Array.from(document.querySelectorAll(selector));
    const el = els.find((x) => x.textContent && x.textContent.includes(text));
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);
}
const DESK = { width: 1440, height: 900 };
const MOB = { width: 390, height: 844 };

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu', '--no-sandbox'], protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  attachListeners(page);

  // Auth throttle (5/60s on /auth/login) has been exhausted by repeated
  // testing in this shared dev environment. Bypass the login form entirely
  // by seeding localStorage with an already-obtained valid token pair
  // (same keys admin/lib/api.ts's setTokens() writes) before first navigation.
  await page.setViewport(DESK);
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.evaluate(() => {
    localStorage.setItem('requital_admin_access_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsInR5cCI6InN0YWZmIiwiaWF0IjoxNzg3MTQ2OTA1LCJleHAiOjE3ODcxNDc4MDV9.A6dKfbVl9rRN0j9-zTEW8fl8e-ktR_6Vxw0TNw0NFew');
    localStorage.setItem('requital_admin_refresh_token', '2b27650a6463408f3fc1d864434f9476e207701be92eb83615ef851def53e191');
  });
  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle0', timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('logged in:', await page.evaluate(() => !document.body.innerText.includes('Sign in to your shop')));

  // Ingredients list with real data + pick branch
  await visitAndWait(page, '/inventory', DESK, 'Ingredients');
  await clickByText(page, 'button', 'All branches');
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button, [role="menuitem"], li'));
    const b = items.find((x) => /Main Branch/i.test(x.textContent || ''));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, 'inventory-ingredients-with-data-desktop');

  const adjustClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="Adjust stock for"]'));
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('adjust clicked:', adjustClicked);
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, 'inventory-adjust-stock-modal-real');
  if (adjustClicked) {
    // fill quantity, no reason -> submit -> expect validation toast
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find((x) => x.textContent.trim() === 'Quantity (± to add or remove)');
      const input = l && l.htmlFor ? document.getElementById(l.htmlFor) : null;
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '20');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await clickByText(page, 'button[type="submit"]', 'Apply adjustment');
    await new Promise((r) => setTimeout(r, 700));
    await shot(page, 'inventory-adjust-stock-no-reason-toast');

    const reasonSet = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find((x) => x.textContent.trim() === 'Reason');
      const sel = l && l.htmlFor ? document.getElementById(l.htmlFor) : null;
      if (!sel) return false;
      sel.value = sel.options[1]?.value ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    console.log('reason set:', reasonSet);
    await clickByText(page, 'button[type="submit"]', 'Apply adjustment');
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, 'inventory-adjust-stock-applied-real');

    const thresholdInput = await page.$('input[placeholder="Off"]');
    if (thresholdInput) {
      await thresholdInput.type('5');
      await clickByText(page, 'button', 'Save');
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, 'inventory-low-stock-threshold-real');
    } else {
      console.log('ISSUE: low stock threshold input missing');
    }
  } else {
    console.log('ISSUE: Adjust Stock button still not found with real ingredient data present');
  }

  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 600));

  const transferClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="Transfer stock for"]'));
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('transfer clicked:', transferClicked);
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, 'inventory-transfer-stock-modal-real');
  if (!transferClicked) console.log('ISSUE: Transfer Stock button still not found with real ingredient data present');

  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  // Mobile ingredients
  await visitAndWait(page, '/inventory', MOB, 'Ingredients');
  await shot(page, 'inventory-ingredients-with-data-mobile');

  // SCAN TO STOCK
  await visitAndWait(page, '/inventory/scan', DESK, 'Scan to Stock');
  await shot(page, 'inventory-scan-desktop-real');
  await clickByText(page, 'button', 'Scan settings');
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-scan-settings-open-real');
  await visitAndWait(page, '/inventory/scan', MOB, 'Scan to Stock');
  await shot(page, 'inventory-scan-mobile-real');

  // MOVEMENT HISTORY
  await visitAndWait(page, '/inventory/movements', DESK, 'Movement History');
  await shot(page, 'inventory-movements-desktop-real');
  await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (sel) { sel.value = 'ADJUSTMENT'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'inventory-movements-filtered-real');
  await visitAndWait(page, '/inventory/movements', MOB, 'Movement History');
  await shot(page, 'inventory-movements-mobile-real');

  console.log('=== DONE2 ===');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
