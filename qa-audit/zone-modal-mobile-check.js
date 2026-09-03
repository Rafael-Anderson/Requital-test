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
  await new Promise((r) => setTimeout(r, 1000));
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await login(page);
  console.log('URL after login:', page.url());
  await new Promise((r) => setTimeout(r, 2000));
  await page.goto(`${ADMIN}/settings/outlets/1/edit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && e.textContent.trim() === 'Delivery Area');
    candidates[0]?.closest('button,a,[role="button"],div')?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find((x) => /new zone/i.test(x.textContent))?.click();
  });
  await new Promise((r) => setTimeout(r, 2200));
  // viewport-only screenshot, not fullPage, so we see exactly what a real mobile user sees
  await page.screenshot({ path: path.join(SHOT_DIR, 'outlets-zone-modal-mobile-viewport.png'), fullPage: false });

  // measure overlap between the radius slider input and the sticky footer buttons
  const overlap = await page.evaluate(() => {
    const radius = document.getElementById('zone-radius');
    const createBtn = Array.from(document.querySelectorAll('button')).find(b => /create zone/i.test(b.textContent));
    if (!radius || !createBtn) return { found: false };
    const r = radius.getBoundingClientRect();
    const c = createBtn.getBoundingClientRect();
    return {
      found: true,
      radiusRect: { top: r.top, bottom: r.bottom },
      footerRect: { top: c.top, bottom: c.bottom },
      overlapsFooter: r.bottom > c.top,
    };
  });
  console.log('Radius vs footer overlap check:', JSON.stringify(overlap, null, 2));

  await browser.close();
})();
