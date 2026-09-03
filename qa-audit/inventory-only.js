const puppeteer = require('puppeteer');
const BASE = 'http://localhost:3001';
const findings = [];
function logIssue(label, msg) { findings.push(`[${label}] ${msg}`); console.log(`ISSUE [${label}]: ${msg}`); }
function attachListeners(page) {
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message.slice(0, 300)}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[http-${res.status()}] ${res.request().method()} ${res.url()}`); });
}
async function shot(page, name) {
  try { await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true, timeout: 15000 }); }
  catch (e) { console.log(`screenshot fail ${name}: ${e.message}`); }
}
async function visit(page, path, viewport) {
  await page.setViewport(viewport);
  try { await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
  catch (e) { console.log(`nav error ${path}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 1200));
}
async function clickByText(page, selector, text) {
  return page.evaluate((selector, text) => {
    const els = Array.from(document.querySelectorAll(selector));
    const el = els.find((x) => x.textContent && x.textContent.includes(text));
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);
}
async function fillByLabel(page, labelText, value, ctx) {
  const ok = await page.evaluate((labelText, value) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const label = labels.find((l) => l.textContent.trim() === labelText);
    if (!label) return 'no-label';
    let el = label.htmlFor ? document.getElementById(label.htmlFor) : null;
    if (!el) return 'no-input';
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, labelText, value);
  if (ok !== 'ok') logIssue(ctx || 'form', `fillByLabel("${labelText}") -> ${ok}`);
  return ok === 'ok';
}

const DESK = { width: 1440, height: 900 };
const MOB = { width: 390, height: 844 };

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu', '--no-sandbox'], protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  attachListeners(page);

  await visit(page, '/login', DESK);
  await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(() => {});
  await page.type('input[type="email"]', 'admin@test-shop.com', { delay: 20 });
  await page.type('input[type="password"]', 'dev-password-123', { delay: 20 });
  await new Promise((r) => setTimeout(r, 300));
  await shot(page, 'inventory-login-filled');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]').catch(() => {}),
  ]);
  await new Promise((r) => setTimeout(r, 2000));
  const loggedIn = await page.evaluate(() => !document.body.innerText.includes('Sign in to your shop'));
  console.log('Logged in:', loggedIn);
  if (!loggedIn) { await shot(page, 'inventory-login-failed'); await browser.close(); process.exit(1); }

  // ---- INGREDIENTS LIST ----
  await visit(page, '/inventory', DESK);
  await shot(page, 'inventory-ingredients-list-desktop');

  await clickByText(page, 'button[aria-haspopup="menu"]', 'New ingredient');
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-new-ingredient-dropdown');
  await clickByText(page, 'button[role="menuitem"]', 'New ingredient');
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, 'inventory-ingredient-modal');
  await fillByLabel(page, 'Name', 'QA Audit Ribbon', 'inventory');
  await fillByLabel(page, 'Unit', 'meters', 'inventory');
  await shot(page, 'inventory-ingredient-modal-filled');
  await clickByText(page, 'button[type="submit"]', 'Add ingredient');
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'inventory-after-add-ingredient');

  // ---- CATEGORIES ----
  await visit(page, '/inventory/categories', DESK);
  await shot(page, 'inventory-categories-desktop');
  await visit(page, '/inventory/categories', MOB);
  await shot(page, 'inventory-categories-mobile');

  // ---- SELECT BRANCH, ADJUST + TRANSFER ----
  await visit(page, '/inventory', DESK);
  await clickByText(page, 'button', 'All branches');
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-outlet-dropdown-open');
  const pickedBranch = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button, [role="menuitem"], li'));
    const b = items.find((x) => /Main Branch/i.test(x.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  });
  console.log('Picked Main Branch:', pickedBranch);
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'inventory-outlet-selected');

  const adjustClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="Adjust stock for"]'));
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('Adjust stock clicked:', adjustClicked);
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, 'inventory-adjust-stock-modal');
  if (!adjustClicked) logIssue('inventory', 'No Adjust Stock icon button rendered even with a branch selected');
  else {
    // Try submitting with quantity but no reason to check validation
    await fillByLabel(page, 'Quantity (± to add or remove)', '20', 'inventory');
    await clickByText(page, 'button[type="submit"]', 'Apply adjustment');
    await new Promise((r) => setTimeout(r, 600));
    await shot(page, 'inventory-adjust-stock-missing-reason-validation');
    // now set a reason and submit properly
    const reasonSet = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find((x) => x.textContent.trim() === 'Reason');
      const sel = l && l.htmlFor ? document.getElementById(l.htmlFor) : null;
      if (!sel) return false;
      sel.value = sel.options[1]?.value ?? '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    console.log('Reason set:', reasonSet);
    await clickByText(page, 'button[type="submit"]', 'Apply adjustment');
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, 'inventory-adjust-stock-applied');
    // Set low stock threshold
    const thresholdInput = await page.$('input[placeholder="Off"]');
    if (thresholdInput) {
      await thresholdInput.type('5');
      await clickByText(page, 'button', 'Save');
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, 'inventory-low-stock-threshold-set');
    } else {
      logIssue('inventory', 'Low stock threshold input not found in Adjust Stock modal');
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const transferClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="Transfer stock for"]'));
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('Transfer stock clicked:', transferClicked);
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, 'inventory-transfer-stock-modal');
  if (!transferClicked) logIssue('inventory', 'No Transfer Stock icon button rendered');

  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));

  // Low stock only filter
  const lowStockClicked = await page.evaluate(() => {
    const cb = document.querySelector('input[aria-label="Low stock only"]');
    if (cb) { cb.click(); return true; }
    return false;
  });
  console.log('Low stock filter clicked:', lowStockClicked);
  await new Promise((r) => setTimeout(r, 700));
  await shot(page, 'inventory-low-stock-filter-on');

  await visit(page, '/inventory', MOB);
  await shot(page, 'inventory-ingredients-list-mobile');

  // ---- SCAN TO STOCK ----
  await visit(page, '/inventory/scan', DESK);
  await shot(page, 'inventory-scan-desktop');
  await clickByText(page, 'button', 'Scan settings');
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-scan-settings-open');
  await visit(page, '/inventory/scan', MOB);
  await shot(page, 'inventory-scan-mobile');

  // ---- MOVEMENT HISTORY ----
  await visit(page, '/inventory/movements', DESK);
  await shot(page, 'inventory-movements-desktop');
  await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (sel) { sel.value = 'ADJUSTMENT'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'inventory-movements-filtered-adjustment');
  await visit(page, '/inventory/movements', MOB);
  await shot(page, 'inventory-movements-mobile');

  console.log('\n=== FINDINGS SUMMARY ===');
  findings.forEach((f) => console.log(f));
  console.log('=== DONE ===');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
