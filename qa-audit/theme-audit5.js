const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const session = JSON.parse(fs.readFileSync(path.join(__dirname, 'session.json'), 'utf8'));

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/CSP|Content Security Policy|eval\(\)|discounts\/auto|isCheckoutAddon|\/related/.test(msg.text())) {
      console.log(`[${label}] CONSOLE ERROR:`, msg.text().slice(0, 300));
    }
  });
  page.on('pageerror', (err) => console.log(`[${label}] PAGE ERROR:`, err.message));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
  console.log('  screenshot:', name);
}

async function getSectionOrder(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-section-row]'));
    return rows.map((r) => r.getAttribute('data-section-row')).filter((id) => id && id !== '__header__' && id !== '__footer__');
  });
}

async function clickByText(page, tag, text) {
  return page.evaluate(
    (tagName, t) => {
      const els = Array.from(document.querySelectorAll(tagName));
      const el = els.find((e) => (e.textContent || '').trim() === t);
      if (el) { el.click(); return true; }
      return false;
    },
    tag,
    text,
  );
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  attachListeners(page, 'theme');
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem('requital_admin_access_token', s.access);
    localStorage.setItem('requital_admin_refresh_token', s.refresh);
  }, session);

  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 3500));

  // ---- Home tab preset click (correct selector: <p> text inside a clickable Card div) ----
  console.log('=== Home tab preset click (corrected selector) ===');
  await page.click('button[aria-label="Layout"]');
  await new Promise((r) => setTimeout(r, 400));
  await clickByText(page, 'button', 'Home tab');
  await new Promise((r) => setTimeout(r, 500));

  await page.click('button[aria-label="Sections"]');
  await new Promise((r) => setTimeout(r, 400));
  const before = await getSectionOrder(page);
  console.log('  sections before preset:', before);
  await page.click('button[aria-label="Layout"]');
  await new Promise((r) => setTimeout(r, 300));
  await clickByText(page, 'button', 'Home tab');
  await new Promise((r) => setTimeout(r, 400));

  const clicked = await clickByText(page, 'p', 'Minimal');
  console.log('  clicked <p>Minimal</p>:', clicked);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'p5-01-after-minimal-preset-click.png');

  const toastText = await page.evaluate(() => document.body.innerText).then((t) => (t.match(/"Minimal"[^\n]*/) || [null])[0]);
  console.log('  toast text found:', toastText);

  await page.click('button[aria-label="Sections"]');
  await new Promise((r) => setTimeout(r, 500));
  const after = await getSectionOrder(page);
  console.log('  sections after "Minimal" preset:', after);
  await shot(page, 'p5-02-sections-after-minimal.png');

  // reload to confirm persistence of preset-applied sections
  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 3000));
  const afterReload = await getSectionOrder(page);
  console.log('  sections after reload:', afterReload);
  console.log('  PRESET PERSISTED:', JSON.stringify(after) === JSON.stringify(afterReload));

  await browser.close();
  console.log('\n=== PHASE 5 DONE ===');
})();
