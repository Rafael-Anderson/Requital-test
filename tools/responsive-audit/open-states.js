#!/usr/bin/env node
// OPEN-state audit for one seeded storefront shop at phone width: the mobile menu (drawer / fullscreen), the bottom
// bar's Search tab, the header search dropdown and the cart drawer. Each check is a measured fact (a rect, an
// elementFromPoint, document.activeElement, body overflow), recorded as pass/fail with the evidence.
//
//   node tools/responsive-audit/open-states.js --fixture out/x/fixture.json --label x [--width 390]
// A cart-drawer check needs a fixture seeded with AUDIT_CART_LAYOUT=drawer.
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const STORE = process.env.AUDIT_STOREFRONT_URL || 'http://localhost:3304';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fx = JSON.parse(fs.readFileSync(arg('fixture'), 'utf8'));
const LABEL = arg('label', 'open');
const W = Number(arg('width', 390));
const H = Number(arg('height', 844));
const OUT = path.join(__dirname, 'out', `open-${LABEL}`);

const results = [];
const check = (name, ok, evidence) => {
  results.push({ name, ok: !!ok, evidence });
  process.stdout.write(ok ? '.' : 'x');
};

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('header', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
}

async function newPage(browser, { consent, cart }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W <= 430, isMobile: W <= 430, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const base = `${STORE}/${fx.subdomain}`;
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ slug, consent, cart, f }) => {
      if (consent) localStorage.setItem(`requital_storefront_cookie_consent:${slug}`, 'declined');
      if (cart) {
        localStorage.setItem(
          `requital_storefront_cart:${slug}`,
          JSON.stringify({ outletId: f.outletId, discountCode: null, giftCardCode: null, items: f.products.slice(0, 3).map((p, i) => ({ productId: p.id, name: p.name, price: 40 + i * 15, thumbnail: '', quantity: 1 + i, maxStock: null })) }),
        );
      }
    },
    { slug: fx.subdomain, consent, cart, f: fx },
  );
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await settle(page);
  return { ctx, page };
}

const rectOf = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  }, sel);

// Is the element's centre actually the topmost thing at that point (not under a fixed bar)?
const reachable = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, topmost: !!top && (top === el || el.contains(top)), by: top ? top.tagName + '.' + String(top.className).slice(0, 40) : null };
  }, sel);

async function menuChecks(browser, cookieBanner) {
  const tag = cookieBanner ? 'menu+banner' : 'menu';
  const { ctx, page } = await newPage(browser, { consent: !cookieBanner, cart: false });
  const trigger = page.locator('button[aria-label="Open menu"]');
  if ((await trigger.count()) === 0) {
    check(`${tag}: no hamburger (template does not use drawer/fullscreen)`, true, 'n/a');
    await ctx.close();
    return;
  }
  const tr = await rectOf(page, 'button[aria-label="Open menu"]');
  // the hamburger must not cover other interactive elements
  const covers = await page.evaluate(() => {
    const t = document.querySelector('button[aria-label="Open menu"]');
    const r = t.getBoundingClientRect();
    const hits = [];
    for (const e of document.querySelectorAll('a[href],button,input')) {
      if (e === t || t.contains(e)) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const w = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (w > 2 && h > 2) hits.push((e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30));
    }
    return hits;
  });
  check(`${tag}: hamburger overlaps no other control`, covers.length === 0, covers.join(', ') || tr);
  // closed panel: nothing focusable inside
  const closed = await page.evaluate(() => {
    const p = document.querySelector('[aria-label="Menu"]');
    if (!p) return { has: false };
    const inert = p.hasAttribute('inert');
    const tabbables = Array.from(p.querySelectorAll('a[href],button,summary')).filter((e) => !e.closest('[inert]'));
    return { has: true, inert, tabbables: tabbables.length };
  });
  check(`${tag}: closed panel is inert (no focusable links)`, closed.has && closed.inert && closed.tabbables === 0, JSON.stringify(closed));
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${tag}-open.png`) });
  const panel = await page.evaluate(() => {
    const p = document.querySelector('[role="dialog"][aria-label="Menu"]');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), focusInside: p.contains(document.activeElement), active: document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName) };
  });
  check(`${tag}: opens as a dialog`, !!panel, JSON.stringify(panel));
  if (panel) {
    check(`${tag}: panel inside the viewport`, panel.x >= 0 && panel.right <= W && panel.y >= 0 && panel.bottom <= H + 1, JSON.stringify(panel));
    check(`${tag}: focus moved into the panel`, panel.focusInside, panel.active);
    const closeBtn = await reachable(page, '[role="dialog"] button[aria-label="Close menu"]');
    check(`${tag}: Close control on screen and topmost`, closeBtn.found && closeBtn.onScreen && closeBtn.topmost, JSON.stringify(closeBtn));
    const lock = await page.evaluate(() => getComputedStyle(document.body).overflow);
    check(`${tag}: page scroll locked`, lock === 'hidden', lock);
    const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`${tag}: no horizontal overflow while open`, !docOverflow, '');
    // trap
    let escaped = false;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('[role="dialog"]'));
      if (!inside) escaped = true;
    }
    check(`${tag}: Tab stays inside the panel (14 presses)`, !escaped, '');
    // last panel item reachable above the cookie banner / bottom edge
    const lastItem = await page.evaluate(() => {
      const p = document.querySelector('[role="dialog"][aria-label="Menu"]');
      const items = Array.from(p.querySelectorAll('a[href],summary')).filter((e) => e.getBoundingClientRect().height > 0);
      const l = items[items.length - 1];
      if (!l) return null;
      l.scrollIntoView({ block: 'end' });
      const r = l.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { bottom: Math.round(r.bottom), vh: innerHeight, topmost: top === l || l.contains(top), by: top && top.tagName };
    });
    check(`${tag}: last menu item reachable (not under a bar)`, !lastItem || (lastItem.topmost && lastItem.bottom <= lastItem.vh), JSON.stringify(lastItem));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ dialog: !!document.querySelector('[role="dialog"][aria-label="Menu"]'), active: document.activeElement && document.activeElement.getAttribute('aria-label'), overflow: getComputedStyle(document.body).overflow }));
    check(`${tag}: Escape closes, focus back on the hamburger, scroll unlocked`, !after.dialog && after.active === 'Open menu' && after.overflow !== 'hidden', JSON.stringify(after));
  }
  await ctx.close();
}

async function searchChecks(browser) {
  const { ctx, page } = await newPage(browser, { consent: true, cart: false });
  const btn = page.locator('button[aria-label="Search"]').first();
  if ((await btn.count()) === 0) {
    check('search: no header search button', true, 'n/a');
  } else {
    await btn.click();
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const i = document.querySelector('input[placeholder^="Search products"]');
      if (!i) return null;
      let p = i.parentElement;
      while (p && !String(p.className).includes('shadow-')) p = p.parentElement;
      const r = (p || i).getBoundingClientRect();
      return { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), inputFocused: document.activeElement === i };
    });
    check('search: dropdown inside the viewport', box && box.x >= 0 && box.right <= W, JSON.stringify(box));
    await page.screenshot({ path: path.join(OUT, 'search-open.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await page.evaluate(() => !document.querySelector('input[placeholder^="Search products"]'));
    check('search: Escape closes it', closed, '');
  }
  await ctx.close();
}

async function bottomBarChecks(browser) {
  const { ctx, page } = await newPage(browser, { consent: false, cart: false });
  const nav = await rectOf(page, 'nav[aria-label="Mobile navigation"]');
  if (!nav) {
    check('bottom-bar: not used by this template', true, 'n/a');
    await ctx.close();
    return;
  }
  const banner = await rectOf(page, '[data-cookie-banner]');
  check('bottom-bar: sits above the cookie banner (no overlap)', !banner || nav.bottom <= banner.y + 1 || nav.y >= banner.bottom - 1, JSON.stringify({ nav, banner }));
  await page.screenshot({ path: path.join(OUT, 'bottom-bar-banner.png') });
  // dismiss the banner, then Search
  await page.getByRole('button', { name: 'Decline non-essential' }).click();
  await page.waitForTimeout(300);
  const nav2 = await rectOf(page, 'nav[aria-label="Mobile navigation"]');
  check('bottom-bar: flush with the bottom edge once the banner is gone', nav2 && nav2.bottom === H, JSON.stringify(nav2));
  await page.getByRole('button', { name: /Search/ }).filter({ hasText: 'Search' }).last().click();
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => !!document.querySelector('input[placeholder^="Search products"]'));
  check('bottom-bar: Search tab opens the search', opened, '');
  // last content is not hidden under the bar: scroll to the end
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => {
    const f = document.querySelector('footer');
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    if (!f || !nav) return null;
    return { footerBottom: Math.round(f.getBoundingClientRect().bottom), navTop: Math.round(nav.getBoundingClientRect().top) };
  });
  check('bottom-bar: end of page clears the bar', !end || end.footerBottom <= end.navTop + 1, JSON.stringify(end));
  await page.screenshot({ path: path.join(OUT, 'bottom-bar-end.png') });
  await ctx.close();
}

async function cartDrawerChecks(browser, withBanner) {
  const tag = withBanner ? 'cart-drawer+banner' : 'cart-drawer';
  const { ctx, page } = await newPage(browser, { consent: !withBanner, cart: true });
  const cartBtn = page.locator('[data-fly-to-cart-target]').first();
  if ((await cartBtn.count()) === 0) {
    check(`${tag}: no cart button`, false, '');
    await ctx.close();
    return;
  }
  const before = await page.evaluate(() => {
    const p = document.querySelector('[aria-label="Cart"]');
    return p ? { has: true, inert: p.hasAttribute('inert'), tabbables: Array.from(p.querySelectorAll('a[href],button')).filter((e) => !e.closest('[inert]')).length } : { has: false };
  });
  if (!before.has) {
    check(`${tag}: shop uses the cart page, not a drawer (seed with AUDIT_CART_LAYOUT=drawer)`, true, 'n/a');
    await ctx.close();
    return;
  }
  check(`${tag}: closed drawer is inert`, before.inert && before.tabbables === 0, JSON.stringify(before));
  await cartBtn.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${tag}-open.png`) });
  const d = await page.evaluate(() => {
    const p = document.querySelector('[role="dialog"][aria-label="Cart"]');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left), right: Math.round(r.right), y: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), focusInside: p.contains(document.activeElement) };
  });
  check(`${tag}: opens as a dialog inside the viewport`, d && d.x >= 0 && d.right <= W && d.bottom <= H + 1, JSON.stringify(d));
  if (d) {
    check(`${tag}: focus moved into the drawer`, d.focusInside, '');
    const checkout = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('[role="dialog"][aria-label="Cart"] a')).find((e) => /checkout/i.test(e.textContent || ''));
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { onScreen: r.top >= 0 && r.bottom <= innerHeight, topmost: top === a || a.contains(top), by: top && top.tagName + '.' + String(top.className).slice(0, 40) };
    });
    check(`${tag}: checkout button on screen and not under the cookie banner`, checkout && checkout.onScreen && checkout.topmost, JSON.stringify(checkout));
    const closeBtn = await reachable(page, '[role="dialog"][aria-label="Cart"] button[aria-label="Close cart"]');
    check(`${tag}: Close control reachable`, closeBtn.found && closeBtn.onScreen && closeBtn.topmost, JSON.stringify(closeBtn));
    const lock = await page.evaluate(() => getComputedStyle(document.body).overflow);
    check(`${tag}: page scroll locked`, lock === 'hidden', lock);
    let escaped = false;
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('[role="dialog"]')))) escaped = true;
    }
    check(`${tag}: Tab stays inside the drawer (14 presses)`, !escaped, '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ dialog: !!document.querySelector('[role="dialog"][aria-label="Cart"]'), overflow: getComputedStyle(document.body).overflow, activeBtn: document.activeElement && document.activeElement.hasAttribute('data-fly-to-cart-target') }));
    check(`${tag}: Escape closes, scroll unlocked, focus back on the cart button`, !after.dialog && after.overflow !== 'hidden' && after.activeBtn, JSON.stringify(after));
  }
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  await menuChecks(browser, false);
  await menuChecks(browser, true);
  await searchChecks(browser);
  await bottomBarChecks(browser);
  await cartDrawerChecks(browser, false);
  await cartDrawerChecks(browser, true);
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ label: LABEL, width: W, results }, null, 2));
  const md = [`# Open states ${LABEL} @ ${W}`, '', ...results.map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` :: ${r.evidence}`}`)];
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n');
  console.log('\n' + md.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
