const puppeteer = require('puppeteer');
const BASE = 'http://localhost:3001';
async function shot(page, name) {
  try { await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true, timeout: 15000 }); }
  catch (e) { console.log(`screenshot fail ${name}: ${e.message}`); }
}
const DESK = { width: 1440, height: 900 };
const MOB = { width: 390, height: 844 };
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--disable-gpu', '--no-sandbox'], protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[http-${res.status()}] ${res.request().method()} ${res.url()}`); });
  page.setDefaultTimeout(25000);

  await page.setViewport(DESK);
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.evaluate(() => {
    localStorage.setItem('requital_admin_access_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsInR5cCI6InN0YWZmIiwiaWF0IjoxNzg3MTQ3Njc0LCJleHAiOjE3ODcxNDg1NzR9.PT-LT-uQEP1KEdah7bAyuhqPM9n4hWemXsQKT29FNyg');
    localStorage.setItem('requital_admin_refresh_token', 'df874e2de83a9986113eaafee1e8168dc960387928fe52a7e04c4dee1edeadf3');
  });

  await page.goto(`${BASE}/inventory/movements`, { waitUntil: 'networkidle0', timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2000));
  console.log('logged in:', await page.evaluate(() => !document.body.innerText.includes('Sign in to your shop')));
  await shot(page, 'inventory-movements-desktop-v2');

  await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (sel) { sel.value = 'ADJUSTMENT'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'inventory-movements-filtered-v2');

  await page.setViewport(MOB);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'inventory-movements-mobile-v2');

  await new Promise((r) => setTimeout(r, 1000));
  await page.setViewport(DESK);
  await page.goto(`${BASE}/inventory/scan`, { waitUntil: 'networkidle0', timeout: 25000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'inventory-scan-desktop-v2');
  await page.setViewport(MOB);
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, 'inventory-scan-mobile-v2');

  console.log('=== DONE3 ===');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
