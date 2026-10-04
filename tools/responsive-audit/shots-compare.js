#!/usr/bin/env node
// Before/after viewport screenshots of the converted list pages (390x844 and 1440x900) from two admin builds
// against the same seeded shop, plus a failing-API state of a few pages (stuck skeleton before, error with Try again after).
//   AUDIT_API_URL=... node tools/responsive-audit/shots-compare.js --before http://localhost:3213 --after http://localhost:3203 --out docs/handoff/n3-shots
const fs = require('fs');
const path = require('path');
const sharp = require('../../admin/node_modules/sharp');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { seed } = require('./seed');
const { seedLists } = require('./seed-lists');
const { loginAdmin } = require('./login');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BUILDS = { before: arg('before'), after: arg('after') };
const OUT = arg('out', 'docs/handoff/n3-shots');
const PAGES = ['/inventory', '/inventory/suppliers', '/inventory/purchase-orders', '/products/discounts', '/products/gift-cards', '/products/templates',
  '/settings/users', '/settings/outlets', '/settings/business/tax-classes', '/settings/business/custom-fields', '/settings/storefront/redirects',
  '/affiliate', '/affiliate/codes', '/affiliate/orders', '/orders/branch-status', '/orders/external-delivery', '/inventory/purchase-orders/1', '/inventory/suppliers/1'];
const FAIL_PAGES = ['/products/discounts', '/inventory/suppliers', '/settings/business/seo', '/integrations/payments', '/reports/margin', '/dashboard'];
const slug = (u) => u.replace(/^\//, '').replace(/\W+/g, '-') || 'home';

async function save(page, file) {
  const buf = await page.screenshot({ fullPage: false });
  for (const q of [80, 65, 50, 40, 30]) {
    const out = await sharp(buf).webp({ quality: q }).toBuffer();
    if (out.length <= 150 * 1024 || q === 30) { fs.writeFileSync(file, out); return; }
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fx = await seed();
  const extra = await seedLists(fx);
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, isMobile: w < 500, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await loginAdmin(ctx, API, fx);
    const page = await ctx.newPage();
    const pages = PAGES.map((u) => u.replace('/inventory/suppliers/1', `/inventory/suppliers/${extra.suppliers[0]?.id}`).replace('/inventory/purchase-orders/1', `/inventory/purchase-orders/${extra.purchaseOrders[0]?.id}`));
    for (const label of ['before', 'after']) {
      for (const u of pages) {
        await page.goto(BUILDS[label] + u, { waitUntil: 'domcontentloaded' });
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
        await page.waitForTimeout(700);
        await save(page, path.join(OUT, `${label}-${slug(u)}-${w}.webp`));
      }
      if (w === 390) {
        await page.route(`${API}/**`, (r) => (r.request().method() === 'GET' && !/\/auth\//.test(r.request().url()) ? r.abort() : r.continue()));
        for (const u of FAIL_PAGES) {
          await page.goto(BUILDS[label] + u, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2500);
          await save(page, path.join(OUT, `${label}-FAILING-${slug(u)}-${w}.webp`));
        }
        await page.unroute(`${API}/**`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(2); });
