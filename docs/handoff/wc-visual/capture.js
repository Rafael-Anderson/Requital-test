// node capture.js <outDir> [filter-substring]
const { chromium } = require('/home/user/Requital-test/e2e/node_modules/playwright');
const fs = require('fs');
const out = process.argv[2]; const filter = process.argv[3] || '';
fs.mkdirSync(out, { recursive: true });
const S = JSON.parse(fs.readFileSync('/tmp/wcvis/state.json', 'utf8'));
const ADMIN = 'http://localhost:4001', SF = 'http://localhost:4002';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const FIXED = new Date('2026-10-01T08:00:00Z');
const results = [];
const SETTLE = 1200;

async function newCtx(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'Asia/Dubai', deviceScaleFactor: 1 });
  await ctx.route(/placehold\.co|maps\.googleapis|maps\.gstatic|fonts\.googleapis|google/, (r) => r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/png', body: PNG }) : r.abort());
  await ctx.addInitScript(() => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); });
  await ctx.route(/\/public\/[^/]+\/(orders|abandoned-carts|newsletter-subscribe)$/, (r) => r.request().method() === 'POST' ? r.abort() : r.fallback());
  await ctx.clock.setFixedTime(FIXED);
  return ctx;
}
const wt = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('WATCHDOG ' + what)), ms))]);
async function shot(page, name) {
  if (filter && !name.includes(filter)) return;
  if (fs.existsSync(`${out}/${name}.png`)) return;
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(SETTLE);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, timeout: 20000 });
  results.push(name);
}
async function go(page, url) { await page.goto(url, { waitUntil: 'load', timeout: 25000 }).catch(async () => { await page.waitForTimeout(500); }); }

async function storefront(browser, shopKey, vpName, vp) {
  const sh = S[shopKey]; const base = `${SF}/${sh.sub}`; const pre = `sf-${shopKey}-${vpName}`;
  const ctx = await newCtx(browser, vp); const page = await ctx.newPage();
  await go(page, base);
  await page.getByRole('button', { name: /decline non-essential/i }).click({ timeout: 4000 }).catch(() => {});
  await shot(page, `${pre}-home`);
  await go(page, `${base}/collections/${sh.collection.slug}`); await shot(page, `${pre}-collection`);
  await go(page, `${base}/products/${sh.p1.slug}`); await shot(page, `${pre}-pdp`);
  await go(page, `${base}/products/${sh.p2.slug}`); await shot(page, `${pre}-pdp-variant`);
  await go(page, `${base}/bio`); await shot(page, `${pre}-bio`);
  await go(page, `${base}/orders/track?token=${sh.trackingToken}`); await shot(page, `${pre}-track`);
  await go(page, `${base}/account/login`); await shot(page, `${pre}-account-login`);
  await go(page, `${base}/account/register`); await shot(page, `${pre}-account-register`);
  await go(page, `${base}/account/forgot-password`); await shot(page, `${pre}-account-forgot`);
  // add to cart from PDP
  await go(page, `${base}/products/${sh.p1.slug}`);
  await page.getByRole('button', { name: /add to cart/i }).first().click().catch((e) => console.error('addtocart', e.message));
  await page.waitForTimeout(700);
  await shot(page, `${pre}-after-add`);
  await go(page, `${base}/cart`); await shot(page, `${pre}-cart`);
  await go(page, `${base}/checkout`); await shot(page, `${pre}-checkout-0`);
  // fill contact, advance
  const fill = async (t, v) => { const el = page.locator(`xpath=//label[contains(normalize-space(.),'${t}')]/following::input[1]`).first(); if (await el.count()) await el.fill(v); };
  await fill('Name', 'Vis Customer'); await fill('Phone', '0501234567'); await fill('Email', 'vis@test.com');
  await shot(page, `${pre}-checkout-0-filled`);
  for (let i = 1; i <= 3; i++) {
    const next = page.getByRole('button', { name: /^continue$/i }).first();
    if (!(await next.count()) || !(await next.isEnabled())) break;
    await next.click(); await page.waitForTimeout(500);
    // pickup option if present
    const pickup = page.getByRole('button', { name: /pickup/i }).first(); if (await pickup.count()) await pickup.click().catch(() => {});
    await shot(page, `${pre}-checkout-${i}`);
  }
  // logged-in account pages: log in against the API directly and replay the cookies at Path=/
  // (the customer cookies are Path-scoped to /public/<slug>, which the storefront's /api proxy path never matches in local dev)
  const lr = await fetch('http://localhost:4000/public/' + sh.sub + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: sh.phone, password: sh.password }) });
  await ctx.addCookies(lr.headers.getSetCookie().map((l) => { const [kv] = l.split(';'); const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' }; }));
  for (const p of ['account', 'account/orders', `account/orders/${sh.orderId}`, 'account/addresses', 'account/wishlist']) {
    await go(page, `${base}/${p}`); await shot(page, `${pre}-${p.replace(/\//g, '-').replace(/-\d+$/, '-detail')}`);
  }
  // interactions: search popover, collection sort dropdown, cart drawer
  await go(page, `${base}/collections/${sh.collection.slug}`);
  await page.waitForSelector('button[aria-label="Search"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(800);
  const sbtn = page.getByRole('button', { name: /^search$/i }).first();
  if (await sbtn.count()) { await sbtn.click().catch(() => {}); await page.keyboard.type('rose'); await page.waitForTimeout(900); await shot(page, `${pre}-i-search`); await page.keyboard.press('Escape'); }
  const sort = page.getByRole('button', { name: /newest|sort/i }).first();
  if (await sort.count()) { await sort.click().catch(() => {}); await page.waitForTimeout(300); await shot(page, `${pre}-i-sort`); await page.keyboard.press('Escape'); }
  await go(page, base);
  await page.waitForSelector('button[aria-label="Open cart"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(800);
  const cartBtn = page.getByRole('button', { name: /open cart/i }).first();
  if (await cartBtn.count()) { await cartBtn.click().catch(() => {}); await page.waitForTimeout(700); await shot(page, `${pre}-i-cart-drawer`); }
  await ctx.close();
}

async function admin(browser, vpName, vp, shopKey) {
  const sh = S[shopKey]; const pre = `ad-${shopKey}-${vpName}`;
  const ctx = await newCtx(browser, vp); const page = await ctx.newPage();
  await go(page, `${ADMIN}/login`); await shot(page, `${pre}-login`);
  await go(page, `${ADMIN}/signup`); await shot(page, `${pre}-signup`);
  await go(page, `${ADMIN}/forgot-password`); await shot(page, `${pre}-forgot`);
  await go(page, `${ADMIN}/login`);
  await page.locator('input[type=email], input[name=email]').first().fill(sh.email); await page.locator('input[type=password]').first().fill(sh.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
  await page.waitForTimeout(3000);
  const routes = JSON.parse(fs.readFileSync('/tmp/wcvis/admin-routes.json', 'utf8'));
  const sub = (r) => r.replace('[id]', sh.orderId).replace('[themeId]', sh.themeId || '0').replace('[outletId]', sh.outletId);
  for (const r of routes) {
    let u = r;
    if (r === '/orders/[id]') u = `/orders/${sh.orderId}`;
    else if (r === '/products/[id]/edit') u = `/products/${sh.p1.id}/edit`;
    else if (r === '/customers/[id]') u = `/customers/${sh.customerId || 1}`;
    else if (r === '/settings/outlets/[outletId]/edit') u = `/settings/outlets/${sh.outletId}/edit`;
    else if (r === '/theme/[themeId]/builder') u = `/theme/${sh.themeId}/builder`;
    else if (r.includes('[')) continue;
    if (r === '/theme/[themeId]/builder' && !sh.themeId) continue;
    const nm = `${pre}-${u.replace(/^\//, '').replace(/\//g, '_') || 'root'}`;
    if (fs.existsSync(`${out}/${nm}.png`)) continue;
    try { await wt((async () => { await go(page, ADMIN + u); await page.waitForTimeout(600); await shot(page, nm); })(), 60000, nm); } catch (e) { console.error(e.message); }
  }
  // interactions: menus and modals
  await go(page, `${ADMIN}/dashboard`); await page.waitForTimeout(800);
  await page.locator('header button').last().click().catch(() => {}); await page.waitForTimeout(400); await shot(page, `${pre}-i-usermenu`); await page.keyboard.press('Escape');
  await page.locator('header button').first().click().catch(() => {}); await page.waitForTimeout(400); await shot(page, `${pre}-i-navmenu`); await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k').catch(() => {}); await page.waitForTimeout(400); await shot(page, `${pre}-i-cmdk`); await page.keyboard.press('Escape');
  await go(page, `${ADMIN}/orders/${sh.orderId}`); await page.waitForTimeout(800);
  await page.getByRole('button', { name: /edit items/i }).first().click().catch(() => {}); await page.waitForTimeout(600); await shot(page, `${pre}-i-edit-items-modal`);
  await ctx.close();
}

async function builder(browser) {
  const sh = S.themed; const pre = 'ad-themed-d-i';
  const ctx = await newCtx(browser, { width: 1280, height: 800 }); const page = await ctx.newPage();
  await go(page, `${ADMIN}/login`);
  await page.locator('input[type=email], input[name=email]').first().fill(sh.email); await page.locator('input[type=password]').first().fill(sh.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click(); await page.waitForTimeout(3000);
  await go(page, `${ADMIN}/theme/${sh.themeId}/builder`); await page.waitForTimeout(1500);
  await page.getByText('Hero', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(800); await shot(page, `${pre}-builder-hero`);
  await page.getByText('Header', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(800); await shot(page, `${pre}-builder-header`);
  const tabs = page.locator('div:has(> button svg)').filter({ hasText: '' });
  await page.locator('button').nth(5).click().catch(() => {}); await page.waitForTimeout(800); await shot(page, `${pre}-builder-tab2`);
  await page.locator('button').nth(6).click().catch(() => {}); await page.waitForTimeout(800); await shot(page, `${pre}-builder-tab3`);
  await page.getByRole('button', { name: /^tablet$/i }).click().catch(() => {}); await page.waitForTimeout(800); await shot(page, `${pre}-builder-tablet`);
  await ctx.close();
}

async function platform(browser, vp) {
  const ctx = await newCtx(browser, vp); const page = await ctx.newPage();
  await go(page, `${ADMIN}/platform/login`); await shot(page, `pl-login`);
  await page.locator('input[type=email], input[name=email]').first().fill('wcvis@test.com'); await page.locator('input[type=password]').first().fill('Password123!');
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click(); await page.waitForTimeout(2500);
  for (const u of ['/platform', '/platform/shops', '/platform/audit-log', '/platform/settings', '/platform/webhooks']) { await go(page, ADMIN + u); await page.waitForTimeout(600); await shot(page, `pl-${u.replace(/\//g, '_')}`); }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-background-networking','--disable-component-update','--disable-sync','--no-proxy-server','--disable-features=OptimizationHints,Translate','--font-render-hinting=none', '--disable-lcd-text'] });
  const only = process.env.ONLY || 'sf,ad,pl';
  if (only.includes('sf')) for (const k of ['legacy', 'themed']) for (const [n, vp] of [['d', { width: 1280, height: 800 }], ['m', { width: 390, height: 844 }]]) await storefront(browser, k, n, vp).catch((e) => console.error('sf fail', k, n, e.message));
  if (only.includes('ad')) { for (const k of ['legacy', 'themed']) await admin(browser, 'd', { width: 1280, height: 800 }, k).catch((e) => console.error('ad fail', k, e.message)); await admin(browser, 'm', { width: 390, height: 844 }, 'legacy').catch((e) => console.error('ad m fail', e.message)); }
  if (only.includes('bld')) await builder(browser).catch((e) => console.error('bld fail', e.message));
  if (only.includes('pl')) await platform(browser, { width: 1280, height: 800 }).catch((e) => console.error('pl fail', e.message));
  await browser.close();
  console.log(results.length, 'shots');
})();
