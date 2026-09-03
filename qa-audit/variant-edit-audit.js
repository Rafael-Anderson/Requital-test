const puppeteer = require('puppeteer');
const path = require('path');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function attachListeners(page, label) {
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[CONSOLE ERROR][${label}] ${msg.text()}`); });
  page.on('pageerror', (err) => console.log(`[PAGE ERROR][${label}] ${err.message}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[HTTP ${res.status()}][${label}] ${res.request().method()} ${res.url()}`); });
}

async function clickByText(page, tag, text) {
  const handle = await page.evaluateHandle(
    (tag, text) => Array.from(document.querySelectorAll(tag)).find((el) => el.textContent && el.textContent.includes(text)) || null,
    tag, text,
  );
  const el = handle.asElement();
  if (el) { await el.click(); return true; }
  return false;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
  console.log('screenshot:', name);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  attachListeners(page, 'login');
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type="submit"]')]);

  attachListeners(page, 'products-list');
  await page.goto(`${ADMIN}/products`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  // find first edit link
  const editHref = await page.evaluate(() => {
    const a = document.querySelector('a[aria-label^="Edit "]');
    return a ? a.getAttribute('href') : null;
  });
  console.log('first product edit href:', editHref);
  if (!editHref) { console.log('NO PRODUCTS TO EDIT'); await browser.close(); return; }

  attachListeners(page, 'product-edit');
  await page.goto(`${ADMIN}${editHref}`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await shot(page, 'products-edit-step1-desktop.png');

  // Jump straight to step 3 via stepper clicks (edit mode marks all visited)
  await clickByText(page, 'button', 'Organization');
  await sleep(500);
  await shot(page, 'products-edit-step3-organization.png');

  // Enable Variants (or it may already be enabled)
  const addVariantsClicked = await clickByText(page, 'button', 'Add variants');
  console.log('clicked Add variants:', addVariantsClicked);
  await sleep(500);
  await shot(page, 'products-edit-variants-section.png');

  // Add an option: Size / Small,Large
  const optionNameInput = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const l = labels.find((x) => x.textContent.trim() === 'Option name');
    return l ? document.getElementById(l.getAttribute('for')) : null;
  });
  const optionNameEl = optionNameInput.asElement();
  if (optionNameEl) {
    await optionNameEl.type('Size');
  } else {
    console.log('OPTION NAME INPUT NOT FOUND - trying Add option first');
    await clickByText(page, 'button', 'Add option');
    await sleep(400);
  }
  await shot(page, 'products-edit-variants-option-name.png');

  const valueDraftInput = await page.$('input[placeholder="Add a value and press Enter"]');
  if (valueDraftInput) {
    await valueDraftInput.type('Small, Large');
    await valueDraftInput.press('Enter');
    await sleep(400);
  } else {
    console.log('VALUE DRAFT INPUT NOT FOUND');
  }
  await shot(page, 'products-edit-variants-values-added.png');

  const saveOptionsClicked = await clickByText(page, 'button', 'Save options');
  console.log('clicked Save options:', saveOptionsClicked);
  await sleep(1200);
  await shot(page, 'products-edit-variants-after-save.png');

  // Try opening first variant's edit modal (pencil icon)
  const editVariantBtn = await page.$('button[aria-label^="Edit "]');
  if (editVariantBtn) {
    await editVariantBtn.click();
    await sleep(600);
    await shot(page, 'products-variant-edit-modal.png');
  } else {
    console.log('NO VARIANT EDIT BUTTON FOUND');
  }

  await browser.close();
})();
