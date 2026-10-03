#!/usr/bin/env node
// Phase 0.3 follow-up for c (slow API), d (swipe with a control) and e (banner located by text).
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { seed } = require('./seed');
const { loginAdmin } = require('./login');
const { swipeHorizontally } = require('./swipe');

const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
const STORE = process.env.AUDIT_STOREFRONT_URL || 'http://localhost:3002';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LABEL = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'before';
const OUT = path.join(__dirname, 'out', `diagnosis-${LABEL}`);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fx = await seed();
  const out = {};
  const browser = await chromium.launch({ executablePath: CHROME });
  const boot = await browser.newContext();
  await loginAdmin(boot, API, fx);
  const state = await boot.storageState();
  await boot.close();

  // ---- c: settings content with an API that takes 1.2s to answer -----------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: state });
    const page = await ctx.newPage();
    await page.route(/\/(auth\/me|shop|outlets|tax-classes)(\?|$)/, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    out.c = [];
    for (const url of ['/settings/business/information', '/settings/business/tax-classes']) {
      await page.goto(ADMIN + url, { waitUntil: 'commit' });
      const t0 = Date.now();
      const samples = [];
      for (const at of [300, 900, 1500, 2200, 3500]) {
        await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
        const s = await page.evaluate(() => {
          const main = document.querySelector('main');
          const aside = Array.from(document.querySelectorAll('nav, aside')).find((n) => /Business|Information|Tax/.test(n.textContent || ''));
          return { mainTextChars: main ? (main.innerText || '').trim().length : 0, sidebarPresent: !!aside, skeletons: document.querySelectorAll('.animate-pulse').length };
        });
        samples.push({ at, ...s });
        if (at === 900 || at === 2200) await page.screenshot({ path: path.join(OUT, `c-slow-${url.replace(/\W+/g, '-')}-${at}ms.png`) });
      }
      out.c.push({ url, samples });
    }
    await ctx.close();
  }

  // ---- d: swipes, with a control element that MUST scroll ------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, storageState: state });
    const page = await ctx.newPage();
    await page.goto(`${ADMIN}/orders`, { waitUntil: 'domcontentloaded' });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await page.waitForTimeout(800);
    // control: a known overflow-x:auto strip
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'swipe-control';
      d.style.cssText = 'overflow-x:auto;width:100%;display:flex;gap:8px;position:relative;z-index:5;background:#fee';
      d.innerHTML = Array.from({ length: 20 }, (_, i) => `<div style="flex:none;width:120px;padding:8px">c${i}</div>`).join('');
      document.querySelector('main').prepend(d);
    });
    out.d = { control: await swipeHorizontally(page, '#swipe-control > div:nth-child(2)') };
    const reset = async (sel) => {
      const h = await page.$(sel);
      if (h) await h.evaluate((el) => { let e = el; while (e && !(getComputedStyle(e).overflowX === 'auto' && e.scrollWidth > e.clientWidth)) e = e.parentElement; if (e) e.scrollLeft = 0; });
    };
    const tab = 'a:has-text("Order History")';
    await reset(tab);
    out.d.tabRow = await swipeHorizontally(page, tab);
    const col = 'text=Pending';
    out.d.kanbanFirstColumn = null;
    const colSel = 'div.flex.gap-4.overflow-x-auto.pb-2 > div:nth-child(1)';
    await reset(colSel);
    out.d.kanban = await swipeHorizontally(page, colSel);
    out.d.kanbanColumnWidths = await page.evaluate(() => Array.from(document.querySelectorAll('div.flex.gap-4.overflow-x-auto.pb-2 > div')).map((c) => Math.round(c.getBoundingClientRect().width)));
    out.d.docOverflowOnOrders = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    await ctx.close();
  }

  // ---- e: cookie banner found by its text ----------------------------------------
  out.e = [];
  for (const [vw, vh, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    for (const [name, url] of [['home', `${STORE}/${fx.subdomain}`], ['pdp', `${STORE}/${fx.subdomain}/products/${fx.products[0].slug}`]]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
      await page.waitForTimeout(1500);
      for (const y of [0, 700]) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(400);
        const info = await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('div')).filter((e) => /We use cookies/.test(e.textContent || '') && getComputedStyle(e).position === 'fixed').pop();
          if (!b) return { present: false };
          const cs = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          const others = Array.from(document.querySelectorAll('*')).filter((e) => e !== b && !b.contains(e) && getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1).map((e) => { const q = e.getBoundingClientRect(); return { el: `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`, top: Math.round(q.top), bottom: Math.round(q.bottom), left: Math.round(q.left), right: Math.round(q.right), overlapsBanner: !(q.bottom <= r.top || q.top >= r.bottom) && !(q.right <= r.left || q.left >= r.right) }; });
          return { present: true, position: cs.position, left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), bottomGap: Math.round(window.innerHeight - r.bottom), clientWidth: document.documentElement.clientWidth, vh: window.innerHeight, buttonHeights: Array.from(b.querySelectorAll('button')).map((x) => Math.round(x.getBoundingClientRect().height)), otherFixed: others };
        });
        const vp = `e2-${name}-${vw}-y${y}.png`;
        await page.screenshot({ path: path.join(OUT, vp), fullPage: false });
        const fp = `e2-${name}-${vw}-y${y}-FULLPAGE.png`;
        await page.screenshot({ path: path.join(OUT, fp), fullPage: true });
        const meta = await page.evaluate(() => ({ docHeight: document.documentElement.scrollHeight }));
        out.e.push({ page: name, viewport: `${vw}x${vh}`, scrollY: y, ...info, docHeight: meta.docHeight, viewportShot: vp, fullPageShot: fp });
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'diagnosis2.json'), JSON.stringify(out, null, 2));
  console.log('wrote diagnosis2.json');
}
main().catch((e) => { console.error(e); process.exit(1); });
