const puppeteer = require('puppeteer');

const BASE = 'http://localhost:3001';
const findings = [];

function logIssue(page, msg) {
  findings.push(`[${page}] ${msg}`);
  console.log(`ISSUE [${page}]: ${msg}`);
}

async function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[console-error][${label}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.log(`[pageerror][${label}] ${err.message}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[http-${res.status()}][${label}] ${res.request().method()} ${res.url()}`);
    }
  });
}

async function shot(page, name) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
}

async function login(page) {
  await attachListeners(page, 'login');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
  const emailSel = await page.$('input[type="email"]') ? 'input[type="email"]' : 'input[name="email"]';
  await page.type(emailSel, 'admin@test-shop.com');
  const pwSel = await page.$('input[type="password"]') ? 'input[type="password"]' : 'input[name="password"]';
  await page.type(pwSel, 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1000));
}

async function visit(page, path, label, viewport) {
  await page.setViewport(viewport);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 30000 }).catch((e) => console.log(`nav error ${path}: ${e.message}`));
  await new Promise((r) => setTimeout(r, 800));
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  await login(page);
  await shot(page, 'login-after');

  const DESK = { width: 1440, height: 900 };
  const MOB = { width: 390, height: 844 };

  // ---------- DISCOUNTS ----------
  await attachListeners(page, 'discounts');
  await visit(page, '/products/discounts', 'discounts-desktop', DESK);
  await shot(page, 'discounts-list-desktop');

  // Open New Discount modal
  const newDiscountBtn = await page.$x ? null : null;
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.includes('New discount'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'discounts-new-modal-code');

  // Create a percentage discount code
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const codeInput = inputs.find((i) => i.previousElementSibling?.textContent === 'Code' || i.closest('div')?.querySelector('label')?.textContent === 'Code');
  });
  // Fill by label proximity: find input near label "Code"
  const codeInputHandle = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const codeLabel = labels.find((l) => l.textContent.trim() === 'Code');
    return codeLabel ? codeLabel.parentElement.querySelector('input') : null;
  });
  if (codeInputHandle && (await codeInputHandle.asElement())) {
    await codeInputHandle.asElement().click({ clickCount: 3 });
    await codeInputHandle.asElement().type('QAAUDIT10');
  } else {
    logIssue('discounts', 'Could not locate Code input field by label text');
  }

  // Value field
  const valueInputHandle = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.includes('Value ('));
    return l ? l.parentElement.querySelector('input') : null;
  });
  if (valueInputHandle && (await valueInputHandle.asElement())) {
    await valueInputHandle.asElement().click({ clickCount: 3 });
    await valueInputHandle.asElement().type('10');
  } else {
    logIssue('discounts', 'Could not locate Value input field for percentage discount');
  }

  await shot(page, 'discounts-new-modal-filled');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
    const b = btns.find((x) => x.textContent.includes('Create discount'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'discounts-after-create-code');

  // Now create an AUTO discount
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.includes('New discount'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // Toggle "Requires code" off
  const toggled = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const label = spans.find((s) => s.textContent.trim() === 'Requires code');
    if (!label) return false;
    const toggleBtn = label.previousElementSibling;
    if (toggleBtn) { toggleBtn.click(); return true; }
    return false;
  });
  if (!toggled) logIssue('discounts', 'Could not find/click "Requires code" toggle');
  await new Promise((r) => setTimeout(r, 300));
  await shot(page, 'discounts-auto-mode-before-fill');

  // Fill value
  const autoValueHandle = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.includes('Value ('));
    return l ? l.parentElement.querySelector('input') : null;
  });
  if (autoValueHandle && (await autoValueHandle.asElement())) {
    await autoValueHandle.asElement().click({ clickCount: 3 });
    await autoValueHandle.asElement().type('15');
  }

  // appliesTo select should now default to SPECIFIC_PRODUCTS (ALL_PRODUCTS filtered out)
  const appliesToInfo = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.trim() === 'Applies to');
    const select = l ? l.parentElement.querySelector('select') : null;
    if (!select) return null;
    return { value: select.value, options: Array.from(select.options).map((o) => o.value) };
  });
  console.log('appliesTo select state after switching to auto:', JSON.stringify(appliesToInfo));

  // Select a product in the multi-select if it appeared
  const productSelectExists = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.includes('Products ('));
    return !!l;
  });
  if (productSelectExists) {
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const l = labels.find((x) => x.textContent.includes('Products ('));
      const select = l.parentElement.querySelector('select');
      if (select && select.options.length > 0) {
        select.options[0].selected = true;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  } else {
    logIssue('discounts', 'Auto-discount product multi-select did not appear despite appliesTo=SPECIFIC_PRODUCTS default');
  }
  await shot(page, 'discounts-auto-mode-filled');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
    const b = btns.find((x) => x.textContent.includes('Create discount'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'discounts-after-create-auto');

  // Check list shows "Auto" badge
  const hasAutoBadge = await page.evaluate(() => document.body.innerText.includes('Auto discount') || document.body.innerText.includes('Auto'));
  console.log('List shows Auto badge text present:', hasAutoBadge);

  // Mobile viewport for discounts list
  await visit(page, '/products/discounts', 'discounts-mobile', MOB);
  await shot(page, 'discounts-list-mobile');

  // ---------- GIFT CARDS ----------
  await attachListeners(page, 'giftcards');
  await visit(page, '/products/gift-cards', 'giftcards-desktop', DESK);
  await shot(page, 'giftcards-list-desktop');

  // Issue a gift card
  const amountHandle = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.trim() === 'Amount');
    return l ? l.parentElement.querySelector('input') : null;
  });
  if (amountHandle && (await amountHandle.asElement())) {
    await amountHandle.asElement().type('250');
  } else {
    logIssue('giftcards', 'Could not locate Amount input for issuing a gift card');
  }
  await shot(page, 'giftcards-issue-filled');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.includes('Issue card'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'giftcards-after-issue');

  await visit(page, '/products/gift-cards', 'giftcards-mobile', MOB);
  await shot(page, 'giftcards-list-mobile');

  // Check product form for gift card config (new product page)
  await attachListeners(page, 'product-new');
  await visit(page, '/inventory/new', 'product-new-desktop', DESK);
  await shot(page, 'giftcards-product-new-basics');
  // Navigate wizard to pricing step if possible by clicking Next
  const bodyTextBasics = await page.evaluate(() => document.body.innerText);
  console.log('Product wizard step1 mentions gift card:', bodyTextBasics.toLowerCase().includes('gift card'));

  // ---------- INGREDIENTS / INVENTORY ----------
  await attachListeners(page, 'inventory');
  await visit(page, '/inventory', 'inventory-desktop', DESK);
  await shot(page, 'inventory-ingredients-list-desktop');

  // Open New ingredient dropdown & modal
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.includes('New ingredient') && x.getAttribute('aria-haspopup'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, 'inventory-new-ingredient-dropdown');
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button[role="menuitem"]'));
    const b = items.find((x) => x.textContent.includes('New ingredient'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-ingredient-modal');

  const nameHandle = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.trim() === 'Name');
    return l ? l.parentElement.querySelector('input') : null;
  });
  if (nameHandle && (await nameHandle.asElement())) {
    await nameHandle.asElement().type('QA Audit Ribbon');
  } else {
    logIssue('inventory', 'Could not locate ingredient Name input');
  }
  const unitHandle = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.trim() === 'Unit');
    return l ? l.parentElement.querySelector('input') : null;
  });
  if (unitHandle && (await unitHandle.asElement())) {
    await unitHandle.asElement().type('meters');
  }
  await shot(page, 'inventory-ingredient-modal-filled');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
    const b = btns.find((x) => x.textContent.includes('Add ingredient'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'inventory-after-add-ingredient');

  // Categories tab
  await visit(page, '/inventory/categories', 'inventory-categories-desktop', DESK);
  await shot(page, 'inventory-categories-desktop');

  // Try Adjust Stock modal - need outlet selected. Check BranchBar / outlet switcher present
  await visit(page, '/inventory', 'inventory-adjust-check', DESK);
  const outletSwitcherPresent = await page.evaluate(() => document.body.innerText.includes('All branches') || !!document.querySelector('[aria-label*="branch" i]'));
  console.log('Outlet switcher visible text present:', outletSwitcherPresent);
  await shot(page, 'inventory-before-outlet-select');

  // Try clicking outlet switcher dropdown if present, pick a branch
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.match(/All branches/i));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, 'inventory-outlet-dropdown-open');
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('button, [role="menuitem"], li'));
    const b = items.find((x) => x.textContent.match(/Main Branch/i));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, 'inventory-outlet-selected');

  // Now try Adjust Stock icon on the first ingredient row
  const adjustClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="Adjust stock for"]'));
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('Adjust stock button clicked:', adjustClicked);
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-adjust-stock-modal');
  if (!adjustClicked) logIssue('inventory', 'No Adjust Stock button found even after selecting a branch');

  // close and try transfer stock
  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  const transferClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="Transfer stock for"]'));
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('Transfer stock button clicked:', transferClicked);
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'inventory-transfer-stock-modal');

  // Mobile ingredients list
  await visit(page, '/inventory', 'inventory-mobile', MOB);
  await shot(page, 'inventory-ingredients-list-mobile');

  // ---------- SCAN TO STOCK ----------
  await attachListeners(page, 'scan');
  await visit(page, '/inventory/scan', 'scan-desktop', DESK);
  await shot(page, 'inventory-scan-desktop');
  // Open scan settings
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.includes('Scan settings'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await shot(page, 'inventory-scan-settings-open');

  await visit(page, '/inventory/scan', 'scan-mobile', MOB);
  await shot(page, 'inventory-scan-mobile');

  // ---------- MOVEMENT HISTORY ----------
  await attachListeners(page, 'movements');
  await visit(page, '/inventory/movements', 'movements-desktop', DESK);
  await shot(page, 'inventory-movements-desktop');
  // try filter dropdown
  await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (sel) { sel.value = 'ADJUSTMENT'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, 'inventory-movements-filtered-adjustment');

  await visit(page, '/inventory/movements', 'movements-mobile', MOB);
  await shot(page, 'inventory-movements-mobile');

  console.log('\n=== FINDINGS SUMMARY ===');
  findings.forEach((f) => console.log(f));

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
