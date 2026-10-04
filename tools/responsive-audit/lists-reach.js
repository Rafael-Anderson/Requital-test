#!/usr/bin/env node
// List reachability audit. For every admin list/table page, at each phone viewport: which column
// headers and row controls are inside the viewport at rest, and (for a table that scrolls
// sideways) whether each is reachable after scrolling its own container, proven with a REAL touch
// swipe on the container (with the control element from swipe-check.js first: exit 2 when the
// control does not scroll, the run is invalid).
//   node tools/responsive-audit/lists-reach.js --label before [--viewports 360x780,390x844] [--only /a,/b]
// Seeds a fresh shop plus list rows (seed.js + seed-lists.js). Local servers only.
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { seed } = require('./seed');
const { seedLists } = require('./seed-lists');
const { loginAdmin } = require('./login');
const { swipeHorizontally } = require('./swipe');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LABEL = arg('label', 'lists');
const VIEWPORTS = arg('viewports', '360x780,390x844').split(',').map((v) => ({ w: +v.split('x')[0], h: +v.split('x')[1], name: v }));
const OUT = path.join(__dirname, 'out', LABEL);

const ROUTES = (fx, extra) => [
  '/inventory', '/inventory/categories', '/inventory/movements', '/inventory/suppliers', '/inventory/purchase-orders',
  ...(extra.suppliers[0] ? [`/inventory/suppliers/${extra.suppliers[0].id}`] : []),
  ...(extra.purchaseOrders[0] ? [`/inventory/purchase-orders/${extra.purchaseOrders[0].id}`] : []),
  '/products', '/products/brands', '/products/categories', '/products/discounts', '/products/gift-cards', '/products/templates',
  '/orders/history', '/orders/draft-orders', '/orders/abandoned-carts', '/orders/branch-status', '/orders/external-delivery',
  '/customers', '/customers/newsletter', '/customers/reviews',
  '/affiliate', '/affiliate/codes', '/affiliate/orders', '/bio-links', '/activity-log',
  '/settings/users', '/settings/outlets', '/settings/business/tax-classes', '/settings/business/custom-fields',
  '/settings/storefront/redirects', '/settings/diagnostics', '/settings/security',
  '/integrations/webhooks',
  '/reports', '/reports/monthly', '/reports/product-sales', '/reports/inventory', '/reports/margin', '/reports/prep-time', '/reports/attribution', '/reports/external-delivery',
  '/orders', '/dashboard',
];

// Self-contained: serialised into the page.
function measureLists() {
  const vw = document.documentElement.clientWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const inView = (r) => r.left >= -1 && r.right <= vw + 1;
  const txt = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 28);
  const scrollerOf = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p !== document.body && p !== document.documentElement) return p; } return null; };
  const tables = Array.from(document.querySelectorAll('table')).filter(vis).map((t) => {
    const sc = scrollerOf(t);
    const ths = Array.from(t.querySelectorAll('thead th')).filter(vis).map((th) => { const r = th.getBoundingClientRect(); return { t: txt(th) || '(blank)', inView: inView(r), left: Math.round(r.left), right: Math.round(r.right) }; });
    const rows = Array.from(t.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('td') && !tr.querySelector('td[colspan]') && vis(tr));
    const ctl = (tr) => Array.from(tr.querySelectorAll('a[href],button,input:not([type=hidden]),select')).filter(vis).map((c) => { const r = c.getBoundingClientRect(); return { t: txt(c), inView: inView(r) }; });
    const first = rows[0];
    const lastCell = first ? first.querySelector('td:last-child') : null;
    const lastCtl = lastCell ? Array.from(lastCell.querySelectorAll('a[href],button,input,select')).filter(vis).map((c) => ({ t: txt(c), inView: inView(c.getBoundingClientRect()) })) : [];
    return {
      cols: ths.length,
      colsOff: ths.filter((h) => !h.inView).map((h) => h.t),
      offCount: ths.filter((h) => !h.inView).length,
      rows: rows.length,
      firstRowControls: first ? ctl(first) : [],
      lastCellControls: lastCtl,
      lastCellOff: lastCtl.filter((c) => !c.inView).length,
      scroller: sc ? { scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth, fade: sc.hasAttribute('data-scroll-fade'), stickyFirst: sc.getAttribute('data-sticky-first') === '1' } : null,
      empty: !!t.querySelector('tbody td[colspan]'),
    };
  });
  const cardEls = Array.from(document.querySelectorAll('ul.space-y-2 > li')).filter(vis);
  const cardCtl = cardEls[0] ? Array.from(cardEls[0].querySelectorAll('a[href],button,input,[role=switch]')).filter(vis).map((c) => ({ t: txt(c), inView: inView(c.getBoundingClientRect()) })) : [];
  const cards = cardEls.length;
  const de = document.documentElement;
  return { vw, docOverflow: de.scrollWidth > de.clientWidth, tables, cards, cardCtl, h1: (document.querySelector('h1') || {}).innerText || '', url: location.pathname };
}

// After scrolling every table's scroller to its end: is every header and last-cell control inside the
// viewport and actually the topmost element at its centre (not covered by a sticky column)?
function measureAfterScroll() {
  const vw = document.documentElement.clientWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const out = [];
  for (const t of Array.from(document.querySelectorAll('table')).filter(vis)) {
    let sc = null;
    for (let p = t.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { sc = p; break; } }
    // reachable = scrolling the element's OWN scrollers (innermost first, then any outer sideways scroller such as
    // the settings columns) can bring it inside the viewport
    const reach = (c) => {
      for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) { const r0 = c.getBoundingClientRect(); const s0 = p.getBoundingClientRect(); p.scrollLeft += r0.left + r0.width / 2 - (s0.left + s0.width / 2); }
      }
      const r = c.getBoundingClientRect();
      return r.left >= -1 && r.right <= vw + 1;
    };
    const ths = Array.from(t.querySelectorAll('thead th')).filter(vis);
    const row = Array.from(t.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('td') && !tr.querySelector('td[colspan]') && vis(tr));
    const last = row ? Array.from(row.querySelectorAll('td:last-child a[href],td:last-child button,td:last-child input')).filter(vis) : [];
    out.push({ headersUnreachableAtEnd: ths.filter((h) => !reach(h)).map((h) => h.innerText.trim().slice(0, 20) || '(blank)'), lastCellUnreachable: last.filter((c) => !reach(c)).length, lastCellCount: last.length });
    document.querySelectorAll('[data-scroll-fade]').forEach((e) => (e.scrollLeft = 0));
  }
  return out;
}

async function settle(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* polling */ }
  try {
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('.animate-pulse,[aria-busy="true"],#nprogress .bar')).some((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }), null, { timeout: 10000 });
  } catch { /* leave */ }
  await page.waitForTimeout(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fx = await seed();
  const extra = await seedLists(fx);
  let routes = ROUTES(fx, extra);
  if (arg('only')) routes = routes.filter((r) => arg('only').split(',').some((o) => r === o || r.startsWith(o + '/')));
  const browser = await chromium.launch({ executablePath: CHROME });
  const results = [];
  let invalid = false;
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await loginAdmin(ctx, API, fx);
    const page = await ctx.newPage();
    for (const url of routes) {
      const rec = { url, viewport: vp.name };
      try {
        await page.goto(ADMIN + url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await settle(page);
        Object.assign(rec, await page.evaluate(measureLists));
        rec.finalUrl = new URL(page.url()).pathname;
        if (invalid === false && !rec.controlChecked) {
          // control: a known-scrolling element must move under the same touch drag
          await page.evaluate(() => { const d = document.createElement('div'); d.id = 'swipe-control'; d.style.cssText = 'overflow-x:auto;width:100%;display:flex;position:relative;z-index:5'; d.innerHTML = Array.from({ length: 20 }, (_, i) => `<div style="flex:none;width:120px;padding:8px">c${i}</div>`).join(''); (document.querySelector('main') || document.body).prepend(d); });
          const c = await swipeHorizontally(page, '#swipe-control > div:nth-child(2)');
          rec.controlChecked = true;
          if (!c.scrolled) invalid = true;
          await page.evaluate(() => document.getElementById('swipe-control')?.remove());
        }
        // real swipe on the first sideways-scrolling table, then programmatic end-of-scroll reach
        const scrolling = rec.tables.findIndex((t) => t.scroller && t.scroller.scrollWidth > t.scroller.clientWidth + 1);
        if (scrolling >= 0) {
          const sw = await swipeHorizontally(page, `table >> nth=${scrolling} >> tbody tr:has(td:nth-child(2)) >> nth=0`).catch(() => null);
          rec.swipe = sw ? { scrolled: sw.scrolled, before: sw.before, after: sw.after } : null;
          await page.evaluate(() => document.querySelectorAll('[data-scroll-fade]').forEach((e) => (e.scrollLeft = 0)));
        }
        rec.afterScroll = await page.evaluate(measureAfterScroll);
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 160);
      }
      results.push(rec);
      process.stdout.write(rec.error ? 'E' : '.');
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'lists.json'), JSON.stringify({ label: LABEL, results }, null, 2));
  const lines = ['| route | vp | tables / cards | cols (off at rest) | last-cell controls off at rest | scroll | swipe | unreachable after scroll | card controls off screen |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    if (r.error) { lines.push(`| ${r.url} | ${r.viewport} | ERR ${r.error} |||||| `); continue; }
    const t = r.tables.filter((x) => !x.empty);
    const emptyOnly = r.tables.length > 0 && t.length === 0;
    const a = r.afterScroll || [];
    lines.push(`| ${r.url} | ${r.viewport} | ${r.tables.length}${r.cards ? ` +${r.cards} cards` : ''}${emptyOnly ? ' (empty)' : ''} | ${r.tables.map((x) => `${x.cols}(${x.offCount})`).join(', ')} | ${r.tables.map((x) => `${x.lastCellOff}/${x.lastCellControls.length}`).join(', ')} | ${r.tables.map((x) => (x.scroller ? `${x.scroller.clientWidth}/${x.scroller.scrollWidth}${x.scroller.stickyFirst ? ' sticky' : ''}` : '-')).join(', ')} | ${r.swipe ? (r.swipe.scrolled ? 'ok' : 'NO') : '-'} | ${a.map((x) => x.headersUnreachableAtEnd.length + x.lastCellUnreachable).join(', ')} | ${r.cards ? r.cardCtl.filter((c) => !c.inView).length + '/' + r.cardCtl.length : '-'} |`);
  }
  fs.writeFileSync(path.join(OUT, 'lists.md'), lines.join('\n') + '\n');
  console.log(`\nwrote ${path.join(OUT, 'lists.md')}${invalid ? ' (INVALID: control did not scroll)' : ''}`);
  if (invalid) process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(2); });
