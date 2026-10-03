#!/usr/bin/env node
// Phase 0.3 diagnosis: numbers for each reported symptom. Writes out/diagnosis.json.
// Usage: node tools/responsive-audit/diagnose.js [--label before]
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const sharp = require('../../admin/node_modules/sharp');
const { seed } = require('./seed');
const { measurePage } = require('./measure');
const { swipeHorizontally } = require('./swipe');
const { loginAdmin } = require('./login');

const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
const STORE = process.env.AUDIT_STOREFRONT_URL || 'http://localhost:3002';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LABEL = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'before';
const OUT = path.join(__dirname, 'out', `diagnosis-${LABEL}`);

async function settle(page, ms = 600) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
  try {
    await page.waitForFunction(() => !document.querySelector('.animate-pulse, [aria-busy="true"]'), null, { timeout: 8000 });
  } catch {}
  await page.waitForTimeout(ms);
}

// mean RGB of a vertical strip of a viewport screenshot
async function stripColour(buf, side, vw, vh, strip = 6) {
  const left = side === 'left' ? 0 : side === 'right' ? vw - strip : Math.floor(vw / 2);
  const { data, info } = await sharp(buf).extract({ left: left * 1, top: 0, width: strip, height: Math.min(vh, 400) }).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

async function edgeProbe(page, vw) {
  return page.evaluate((w) => {
    const d = (e) => {
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { el: `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 4).join('.') : ''}`, bg: cs.backgroundColor, w: Math.round(e.getBoundingClientRect().width) };
    };
    return { left: d(document.elementFromPoint(1, 300)), right: d(document.elementFromPoint(w - 2, 300)) };
  }, vw);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fx = await seed();
  const out = { label: LABEL, fixtureSubdomain: fx.subdomain };
  const browser = await chromium.launch({ executablePath: CHROME });
  let state = null; // log in ONCE (the login route is throttled per IP) and share the cookies
  const bootstrap = await browser.newContext();
  await loginAdmin(bootstrap, API, fx);
  state = await bootstrap.storageState();
  await bootstrap.close();
  const mk = async (w, h, { mobile = false, dark = false, login = true } = {}) =>
    browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', ...(login ? { storageState: state } : {}) });

  // ---- a. dark bands -------------------------------------------------------
  out.a = [];
  for (const [vw, vh, mobile] of [[390, 844, true], [1440, 900, false]]) {
    for (const dark of [false, true]) {
      const ctx = await mk(vw, vh, { mobile, dark });
      const page = await ctx.newPage();
      for (const [app, url] of [['admin', `${ADMIN}/dashboard`], ['admin', `${ADMIN}/settings/business/information`], ['storefront', `${STORE}/${fx.subdomain}`], ['storefront', `${STORE}/${fx.subdomain}/cart`]]) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await settle(page);
        const m = await page.evaluate(measurePage);
        const buf = await page.screenshot({ fullPage: false });
        const full = await page.screenshot({ fullPage: true });
        const fullMeta = await sharp(full).metadata();
        const edge = await edgeProbe(page, vw);
        out.a.push({
          app, url: new URL(url).pathname, viewport: `${vw}x${vh}`, osColorScheme: dark ? 'dark' : 'light',
          innerWidth: m.innerWidth, docScrollWidth: m.docScrollWidth, htmlBg: m.htmlBg, bodyBg: m.bodyBg, cssColorScheme: m.colorScheme,
          leftStrip: await stripColour(buf, 'left', vw * (mobile ? 2 : 1), vh, 6 * (mobile ? 2 : 1)),
          rightStrip: await stripColour(buf, 'right', vw * (mobile ? 2 : 1), vh, 6 * (mobile ? 2 : 1)),
          centreStrip: await stripColour(buf, 'centre', vw * (mobile ? 2 : 1), vh, 6 * (mobile ? 2 : 1)),
          fullPageShotWidthPx: fullMeta.width, viewportShotWidthPx: vw * (mobile ? 2 : 1), edge,
        });
      }
      await ctx.close();
    }
  }

  // ---- b. dashboard at 390: which element widens the document ----------------
  {
    const ctx = await mk(390, 844, { mobile: true });
    const page = await ctx.newPage();
    await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    out.b = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const chain = (el) => {
        const rows = [];
        for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          rows.push({ el: `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 6).join('.') : ''}`, w: Math.round(r.width), right: Math.round(r.right), minW: cs.minWidth, display: cs.display, overflowX: cs.overflowX });
        }
        return rows;
      };
      let widest = null, wr = 0;
      for (const e of document.body.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.width > 1 && r.right > wr && !e.closest('svg')) { wr = r.right; widest = e; }
      }
      const header = document.querySelector('a[aria-label="Requital home"]')?.parentElement;
      return { innerWidth: vw, docScrollWidth: document.documentElement.scrollWidth, headerWidth: header && Math.round(header.getBoundingClientRect().width), widestRight: Math.round(wr), widestChain: widest ? chain(widest).slice(0, 8) : null, inputs: Array.from(document.querySelectorAll('input,select')).map((i) => ({ type: i.type, w: Math.round(i.getBoundingClientRect().width), right: Math.round(i.getBoundingClientRect().right) })).slice(0, 8) };
    });
    await page.screenshot({ path: path.join(OUT, 'b-dashboard-390.png') });
    await ctx.close();
  }

  // ---- c. settings content at 1440: timing vs layout ---------------------------
  {
    const ctx = await mk(1440, 900);
    const page = await ctx.newPage();
    out.c = [];
    for (const url of ['/settings/business/information', '/settings/business/tax-classes', '/settings/business/store-configuration']) {
      const t0 = Date.now();
      await page.goto(ADMIN + url, { waitUntil: 'commit' });
      const samples = [];
      for (const at of [150, 400, 800, 1500, 3000, 6000]) {
        await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
        samples.push(await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label], aside, nav');
          const main = document.querySelector('main');
          const cards = main ? main.querySelectorAll('[class*="rounded"]').length : 0;
          return { t: Math.round(performance.now()), mainTextChars: main ? (main.innerText || '').trim().length : 0, hasSidebar: !!nav, cards, skeletons: document.querySelectorAll('.animate-pulse').length };
        }));
        samples[samples.length - 1].at = at;
      }
      const shotEarly = path.join(OUT, `c-${url.replace(/\W+/g, '-')}-early.png`);
      await page.goto(ADMIN + url, { waitUntil: 'commit' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: shotEarly });
      out.c.push({ url, samples, earlyShot: path.basename(shotEarly) });
    }
    await ctx.close();
  }

  // ---- d. touch swipes at 390 ---------------------------------------------------
  {
    const ctx = await mk(390, 844, { mobile: true });
    const page = await ctx.newPage();
    await page.goto(`${ADMIN}/orders`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    out.d = {
      tabRow: await swipeHorizontally(page, 'a:has-text("Draft Orders"), button:has-text("Draft Orders")'),
      kanban: await swipeHorizontally(page, 'text=Out for Delivery/Ready'),
    };
    out.d.tabRowAfterOneMoreSwipe = await swipeHorizontally(page, 'a:has-text("Draft Orders"), button:has-text("Draft Orders")', { distance: -260 });
    await page.screenshot({ path: path.join(OUT, 'd-orders-390.png') });
    await ctx.close();
  }

  // ---- e. cookie banner ----------------------------------------------------------
  out.e = [];
  for (const [vw, vh, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const ctx = await mk(vw, vh, { mobile, login: false });
    const page = await ctx.newPage();
    for (const [name, url] of [['home', `${STORE}/${fx.subdomain}`], ['pdp', `${STORE}/${fx.subdomain}/products/${fx.products[0].slug}`]]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settle(page, 1200);
      for (const scrolled of [0, 600]) {
        await page.evaluate((y) => window.scrollTo(0, y), scrolled);
        await page.waitForTimeout(300);
        const info = await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('[role="dialog"], [class*="cookie" i], [aria-label*="cookie" i]')).find((e) => /cookie|consent|privacy/i.test(e.textContent || '') && getComputedStyle(e).display !== 'none');
          if (!b) return { present: false };
          const cs = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          const fixed = Array.from(document.querySelectorAll('*')).filter((e) => getComputedStyle(e).position === 'fixed' && e !== b && !b.contains(e) && e.getBoundingClientRect().width > 1).map((e) => ({ el: `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`, top: Math.round(e.getBoundingClientRect().top), bottom: Math.round(e.getBoundingClientRect().bottom), overlapsBanner: !(e.getBoundingClientRect().bottom <= r.top || e.getBoundingClientRect().top >= r.bottom) }));
          return { present: true, position: cs.position, x: Math.round(r.left), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), bottomGap: Math.round(window.innerHeight - r.bottom), vw: window.innerWidth, vh: window.innerHeight, safeAreaPadding: cs.paddingBottom, buttonHeights: Array.from(b.querySelectorAll('button')).map((x) => Math.round(x.getBoundingClientRect().height)), otherFixed: fixed };
        });
        const shot = `e-${name}-${vw}-${scrolled}.png`;
        await page.screenshot({ path: path.join(OUT, shot), fullPage: false });
        const full = `e-${name}-${vw}-${scrolled}-FULLPAGE.png`;
        await page.screenshot({ path: path.join(OUT, full), fullPage: true });
        out.e.push({ page: name, viewport: `${vw}x${vh}`, scrollY: scrolled, ...info, viewportShot: shot, fullPageShot: full });
      }
    }
    await ctx.close();
  }

  // ---- f. viewport meta ------------------------------------------------------------
  out.f = {};
  for (const [k, u] of [['admin', `${ADMIN}/login`], ['storefront', `${STORE}/${fx.subdomain}`]]) {
    const html = await (await fetch(u)).text();
    out.f[k] = (html.match(/<meta name="viewport"[^>]*>/g) || []);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'diagnosis.json'), JSON.stringify(out, null, 2));
  console.log(`wrote ${path.join(OUT, 'diagnosis.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
