const puppeteer = require('puppeteer');

const BASE = 'http://localhost:3001';
const findings = [];

function logIssue(label, msg) {
  findings.push(`[${label}] ${msg}`);
  console.log(`ISSUE [${label}]: ${msg}`);
}

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console-error][${label}] ${msg.text().slice(0, 300)}`);
  });
  page.on('pageerror', (err) => console.log(`[pageerror][${label}] ${err.message.slice(0, 300)}`));
  page.on('response', (res) => {
    if (res.status() >= 400) console.log(`[http-${res.status()}][${label}] ${res.request().method()} ${res.url()}`);
  });
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`screenshot fail ${name}: ${e.message}`);
  }
}

async function visit(page, path, viewport) {
  await page.setViewport(viewport);
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    console.log(`nav error ${path}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 900));
}

// Fills an <input>/<select> located via its <label>'s htmlFor -> id, which
// is how this app's Input/Select components associate label to control
// (see Input.tsx: label htmlFor={inputId}, input id={inputId}).
async function fillByLabel(page, labelText, value, opts = {}) {
  const ok = await page.evaluate(
    (labelText, value, exact) => {
      const labels = Array.from(document.querySelectorAll('label'));
      const label = labels.find((l) =>
        exact ? l.textContent.trim() === labelText : l.textContent.includes(labelText),
      );
      if (!label) return 'no-label';
      let el = null;
      if (label.htmlFor) el = document.getElementById(label.htmlFor);
      if (!el) el = label.parentElement?.parentElement?.querySelector('input,select,textarea');
      if (!el) return 'no-input';
      el.focus();
      const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    },
    labelText,
    value,
    opts.exact !== false,
  );
  if (ok !== 'ok') logIssue(opts.ctx || 'form', `fillByLabel("${labelText}") -> ${ok}`);
  return ok === 'ok';
}

async function clickByText(page, selector, text) {
  return page.evaluate(
    (selector, text) => {
      const els = Array.from(document.querySelectorAll(selector));
      const el = els.find((x) => x.textContent && x.textContent.includes(text));
      if (el) { el.click(); return true; }
      return false;
    },
    selector,
    text,
  );
}

async function toggleByLabelSibling(page, spanText) {
  return page.evaluate((spanText) => {
    const spans = Array.from(document.querySelectorAll('span'));
    const span = spans.find((s) => s.textContent.trim() === spanText);
    if (!span) return false;
    const btn = span.previousElementSibling;
    if (btn && btn.tagName === 'BUTTON') { btn.click(); return true; }
    // Toggle.tsx might render the button as a sibling within a wrapping div
    const wrapper = span.closest('div');
    const anyBtn = wrapper ? wrapper.querySelector('button') : null;
    if (anyBtn) { anyBtn.click(); return true; }
    return false;
  }, spanText);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  attachListeners(page, 'global');

  const DESK = { width: 1440, height: 900 };
  const MOB = { width: 390, height: 844 };

  // ---- LOGIN ----
  await visit(page, '/login', DESK);
  await fillByLabel(page, 'Email', 'admin@test-shop.com', { ctx: 'login' }).catch(() => {});
  // login form may not use Input component the same way; fall back to direct selectors
  const hasEmail = await page.$('input[type="email"]');
  if (!hasEmail) {
    await page.evaluate(() => {});
  }
  if (await page.$('input[type="email"]')) {
    await page.type('input[type="email"]', 'admin@test-shop.com');
  }
  if (await page.$('input[type="password"]')) {
    await page.type('input[type="password"]', 'dev-password-123');
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]').catch(() => {}),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, 'login-after');

  // =========================================================
  // DISCOUNTS
  // =========================================================
  try {
    await visit(page, '/products/discounts', DESK);
    await shot(page, 'discounts-list-desktop');

    await clickByText(page, 'button', 'New discount');
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'discounts-new-modal-code');

    await fillByLabel(page, 'Code', 'QAAUDIT10', { ctx: 'discounts', exact: true });
    await fillByLabel(page, 'Value (%)', '10', { ctx: 'discounts', exact: true });
    await shot(page, 'discounts-new-modal-filled');

    await clickByText(page, 'button[type="submit"]', 'Create discount');
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, 'discounts-after-create-code');

    // AUTO discount
    await clickByText(page, 'button', 'New discount');
    await new Promise((r) => setTimeout(r, 500));
    const toggled = await toggleByLabelSibling(page, 'Requires code');
    if (!toggled) logIssue('discounts', 'Could not toggle "Requires code" off');
    await new Promise((r) => setTimeout(r, 300));
    await fillByLabel(page, 'Value (%)', '15', { ctx: 'discounts', exact: true });

    const appliesToInfo = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find((x) => x.textContent.trim() === 'Applies to');
      const select = l && l.htmlFor ? document.getElementById(l.htmlFor) : null;
      if (!select) return null;
      return { value: select.value, options: Array.from(select.options).map((o) => o.value) };
    });
    console.log('appliesTo state after auto toggle:', JSON.stringify(appliesToInfo));
    if (appliesToInfo && appliesToInfo.options.includes('ALL_PRODUCTS')) {
      logIssue('discounts', 'ALL_PRODUCTS still selectable in "Applies to" after switching to auto-apply');
    }

    const pickedProduct = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find((x) => x.textContent.includes('Products ('));
      const select = l && l.htmlFor ? document.getElementById(l.htmlFor) : null;
      if (!select || select.options.length === 0) return false;
      select.options[0].selected = true;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    if (!pickedProduct) logIssue('discounts', 'Could not select a product for the auto-apply discount (multi-select missing or empty)');
    await shot(page, 'discounts-auto-mode-filled');

    await clickByText(page, 'button[type="submit"]', 'Create discount');
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, 'discounts-after-create-auto');

    const listText = await page.evaluate(() => document.body.innerText);
    console.log('Discounts list contains "Auto":', listText.includes('Auto'));
    console.log('Discounts list contains QAAUDIT10:', listText.includes('QAAUDIT10'));

    await visit(page, '/products/discounts', MOB);
    await shot(page, 'discounts-list-mobile');
  } catch (e) {
    console.log('DISCOUNTS SECTION ERROR:', e.message);
  }

  // =========================================================
  // GIFT CARDS
  // =========================================================
  try {
    await visit(page, '/products/gift-cards', DESK);
    await shot(page, 'giftcards-list-desktop');

    await fillByLabel(page, 'Amount', '250', { ctx: 'giftcards', exact: true });
    await fillByLabel(page, 'Expires (optional)', '', { ctx: 'giftcards', exact: true });
    await shot(page, 'giftcards-issue-filled');
    await clickByText(page, 'button', 'Issue card');
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, 'giftcards-after-issue');

    const gcListText = await page.evaluate(() => document.body.innerText);
    console.log('Gift card list contains balance 250:', gcListText.includes('250'));

    await visit(page, '/products/gift-cards', MOB);
    await shot(page, 'giftcards-list-mobile');

    // Check product wizard pricing step for gift card config
    await visit(page, '/inventory/new', DESK);
    await shot(page, 'giftcards-product-new-step1');
    const stepperClicked = await clickByText(page, 'button, [role="tab"], li', 'Pricing');
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'giftcards-product-new-pricing-step');
    const pricingBodyText = await page.evaluate(() => document.body.innerText);
    console.log('Pricing step mentions "gift card":', pricingBodyText.toLowerCase().includes('gift card'));
  } catch (e) {
    console.log('GIFTCARDS SECTION ERROR:', e.message);
  }

  // =========================================================
  // INGREDIENTS / INVENTORY
  // =========================================================
  try {
    await visit(page, '/inventory', DESK);
    await shot(page, 'inventory-ingredients-list-desktop');

    await clickByText(page, 'button[aria-haspopup="menu"]', 'New ingredient');
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, 'inventory-new-ingredient-dropdown');
    await clickByText(page, 'button[role="menuitem"]', 'New ingredient');
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'inventory-ingredient-modal');

    await fillByLabel(page, 'Name', 'QA Audit Ribbon', { ctx: 'inventory', exact: true });
    await fillByLabel(page, 'Unit', 'meters', { ctx: 'inventory', exact: true });
    await shot(page, 'inventory-ingredient-modal-filled');
    await clickByText(page, 'button[type="submit"]', 'Add ingredient');
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, 'inventory-after-add-ingredient');

    await visit(page, '/inventory/categories', DESK);
    await shot(page, 'inventory-categories-desktop');

    // Select a branch via outlet switcher
    await visit(page, '/inventory', DESK);
    await clickByText(page, 'button', 'All branches');
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, 'inventory-outlet-dropdown-open');
    await clickByText(page, 'button, [role="menuitem"], li', 'Main Branch');
    await new Promise((r) => setTimeout(r, 900));
    await shot(page, 'inventory-outlet-selected');

    const adjustClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label^="Adjust stock for"]'));
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    console.log('Adjust stock clicked:', adjustClicked);
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'inventory-adjust-stock-modal');
    if (!adjustClicked) logIssue('inventory', 'No Adjust Stock icon button found after selecting a branch');
    else {
      await fillByLabel(page, 'Quantity (± to add or remove)', '20', { ctx: 'inventory', exact: true });
      await shot(page, 'inventory-adjust-stock-filled-no-reason');
      await clickByText(page, 'button[type="submit"]', 'Apply adjustment');
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, 'inventory-adjust-stock-no-reason-result');
    }

    await page.keyboard.press('Escape').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const transferClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label^="Transfer stock for"]'));
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    console.log('Transfer stock clicked:', transferClicked);
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'inventory-transfer-stock-modal');
    if (!transferClicked) logIssue('inventory', 'No Transfer Stock icon button found');

    await page.keyboard.press('Escape').catch(() => {});
    await new Promise((r) => setTimeout(r, 400));

    await visit(page, '/inventory', MOB);
    await shot(page, 'inventory-ingredients-list-mobile');
  } catch (e) {
    console.log('INGREDIENTS SECTION ERROR:', e.message);
  }

  // =========================================================
  // SCAN TO STOCK
  // =========================================================
  try {
    await visit(page, '/inventory/scan', DESK);
    await shot(page, 'inventory-scan-desktop');
    await clickByText(page, 'button', 'Scan settings');
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, 'inventory-scan-settings-open');

    await visit(page, '/inventory/scan', MOB);
    await shot(page, 'inventory-scan-mobile');
  } catch (e) {
    console.log('SCAN SECTION ERROR:', e.message);
  }

  // =========================================================
  // MOVEMENT HISTORY
  // =========================================================
  try {
    await visit(page, '/inventory/movements', DESK);
    await shot(page, 'inventory-movements-desktop');
    await page.evaluate(() => {
      const sel = document.querySelector('select');
      if (sel) { sel.value = 'ADJUSTMENT'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await new Promise((r) => setTimeout(r, 900));
    await shot(page, 'inventory-movements-filtered-adjustment');

    await visit(page, '/inventory/movements', MOB);
    await shot(page, 'inventory-movements-mobile');
  } catch (e) {
    console.log('MOVEMENTS SECTION ERROR:', e.message);
  }

  console.log('\n=== FINDINGS SUMMARY ===');
  findings.forEach((f) => console.log(f));
  console.log('=== DONE ===');

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
