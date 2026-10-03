#!/usr/bin/env node
// Optional check: does a region actually scroll sideways under a REAL touch drag?
//
//   node tools/responsive-audit/swipe-check.js                       # built-in admin list checks
//   node tools/responsive-audit/swipe-check.js --url /orders \
//        --selectors 'a:has-text("Order History")|[data-scroll-fade] > div:nth-child(1)'
//
// Each selector is swiped (Input.dispatchTouchEvent via swipe.js) and its nearest horizontal
// scroller must move. A control element that is known to scroll is injected first and MUST move,
// otherwise the run is invalid (the harness, not the page, is broken) and exits 2. Exit 1 when
// any selector does not scroll, 0 otherwise. Uses AUDIT_API_URL / AUDIT_ADMIN_URL / AUDIT_CHROME.
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { seed } = require('./seed');
const { loginAdmin } = require('./login');
const { swipeHorizontally } = require('./swipe');

const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

// Phone-width regions that must scroll sideways (390 wide, so the Orders tab row overflows).
const DEFAULT_CHECKS = [
  { url: '/orders', selectors: ['a:has-text("Order History")', '[data-scroll-fade].snap-x > div:nth-child(1)'] },
  { url: '/products', selectors: ['a:has-text("Collections")'] },
];

async function main() {
  const [w, h] = arg('viewport', '390x844').split('x').map(Number);
  const checks = arg('url')
    ? [{ url: arg('url'), selectors: arg('selectors', '').split('|').filter(Boolean) }]
    : DEFAULT_CHECKS;
  const fx = await seed();
  const browser = await chromium.launch({ executablePath: CHROME });
  const boot = await browser.newContext();
  await loginAdmin(boot, API, fx);
  const state = await boot.storageState();
  await boot.close();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, storageState: state });
  const page = await ctx.newPage();
  let invalid = false;
  const failures = [];
  for (const { url, selectors } of checks) {
    await page.goto(ADMIN + url, { waitUntil: 'domcontentloaded' });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch { /* polling pages */ }
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      document.getElementById('swipe-control')?.remove();
      const d = document.createElement('div');
      d.id = 'swipe-control';
      d.style.cssText = 'overflow-x:auto;width:100%;display:flex;position:relative;z-index:5';
      d.innerHTML = Array.from({ length: 20 }, (_, i) => `<div style="flex:none;width:120px;padding:8px">c${i}</div>`).join('');
      (document.querySelector('main') || document.body).prepend(d);
    });
    const control = await swipeHorizontally(page, '#swipe-control > div:nth-child(2)');
    console.log(`${url} control: ${control.before} -> ${control.after} ${control.scrolled ? 'ok' : 'DID NOT SCROLL (invalid run)'}`);
    if (!control.scrolled) invalid = true;
    for (const sel of selectors) {
      // start from scrollLeft 0 so a region left scrolled by an earlier step is not misread
      const el = await page.$(sel);
      if (el) await el.evaluate((n) => { let e = n; while (e && !(getComputedStyle(e).overflowX === 'auto' && e.scrollWidth > e.clientWidth)) e = e.parentElement; if (e) e.scrollLeft = 0; });
      const r = await swipeHorizontally(page, sel);
      const ok = r.found && r.hasScroller && r.scrolled;
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${sel}  container=${r.container || 'n/a'} scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth} scrollLeft ${r.before} -> ${r.after}`);
      if (!ok) failures.push(`${url} ${sel}`);
    }
  }
  await browser.close();
  if (invalid) { console.error('control did not scroll: the swipe harness is not valid in this browser'); process.exit(2); }
  if (failures.length) { console.error('FAILED:\n' + failures.join('\n')); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(2); });
