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

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
  console.log('screenshot:', name);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type="submit"]')]);

  // Mobile: product create wizard step1
  attachListeners(page, 'wizard-mobile');
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${ADMIN}/products/new`, { waitUntil: 'networkidle2' });
  await sleep(800);
  await shot(page, 'products-wizard-step1-mobile.png');
  await page.setViewport({ width: 1440, height: 900 });

  // Advanced mode: toggle shop.productEditorMode to advanced via Business Information page,
  // then revisit product edit to see the single-page layout.
  attachListeners(page, 'settings-business-info');
  await page.goto(`${ADMIN}/settings/business/information`, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await shot(page, 'settings-business-information.png');

  await browser.close();
})();
