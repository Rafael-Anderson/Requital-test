const puppeteer = require('puppeteer');
const path = require('path');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';

async function login(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`); });
  page.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`); });

  await page.setViewport({ width: 1440, height: 900 });
  await login(page);
  await page.goto(`${ADMIN}/settings/outlets/1/edit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && e.textContent.trim() === 'Address');
    candidates[0]?.closest('button,a,[role="button"],div')?.click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'outlets-address-tab-mappicker.png'), fullPage: true });

  const mapState = await page.evaluate(() => {
    const mapDivs = Array.from(document.querySelectorAll('div[class*="h-64"]'));
    return mapDivs.map((d) => ({ hasGmStyle: !!d.querySelector('.gm-style'), childCount: d.children.length }));
  });
  console.log('MapPicker state:', JSON.stringify(mapState));
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Contains "Failed to load Google Maps":', bodyText.includes('Failed to load Google Maps'));

  await browser.close();
})();
