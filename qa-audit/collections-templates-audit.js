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
    (tag, text) => Array.from(document.querySelectorAll(tag)).find((el) => el.textContent && el.textContent.trim() === text || (el.textContent && el.textContent.includes(text))) || null,
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
  console.log('logged in');

  // ===== Collections (taxonomy tree) =====
  attachListeners(page, 'collections');
  await page.goto(`${ADMIN}/products/categories`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await shot(page, 'collections-list-desktop.png');

  // New collection
  await clickByText(page, 'button', 'New collection');
  await sleep(500);
  await shot(page, 'collections-new-modal.png');
  const nameInput = await page.$('input');
  if (nameInput) await nameInput.type('QA Audit Test Collection');
  await sleep(300);
  await shot(page, 'collections-new-modal-filled.png');
  await clickByText(page, 'button', 'Create collection');
  await sleep(1000);
  await shot(page, 'collections-after-create.png');

  // Mobile
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${ADMIN}/products/categories`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await shot(page, 'collections-list-mobile.png');
  await page.setViewport({ width: 1440, height: 900 });

  // ===== Templates (marketing groupings) =====
  attachListeners(page, 'templates');
  await page.goto(`${ADMIN}/products/templates`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await shot(page, 'templates-list-desktop.png');

  await page.goto(`${ADMIN}/products/templates/new`, { waitUntil: 'networkidle2' });
  await sleep(800);
  await shot(page, 'templates-new-desktop.png');

  const titleInput = await page.$('input');
  if (titleInput) await titleInput.type('QA Audit Test Template');
  await sleep(300);

  // Switch type to RULE_BASED to see its own fields
  const typeCombo = await page.$('button[role="combobox"]');
  if (typeCombo) {
    await typeCombo.click();
    await sleep(300);
    await shot(page, 'templates-type-dropdown-open.png');
  }
  await browser.close();
})();
