#!/usr/bin/env node
// TopBar position and scroll behaviour at 1440, 768 and 390: computed position/top/z-index, where the
// bar sits after scrolling, and whether the banner/modal layering still holds (screenshots at 390 scrolled).
//   node tools/responsive-audit/topbar-check.js --label before [--shots dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { seed } = require('./seed');
const { seedLists } = require('./seed-lists');
const { loginAdmin } = require('./login');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = arg('shots', '');
const label = arg('label', 'run');
(async () => {
  const fx = await seed();
  await seedLists(fx);
  const browser = await chromium.launch({ executablePath: CHROME });
  const out = [];
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, isMobile: w < 500, reducedMotion: 'reduce' });
    await loginAdmin(ctx, API, fx);
    const page = await ctx.newPage();
    for (const url of ['/products/discounts', '/settings/users', '/products/new']) {
      await page.goto(ADMIN + url, { waitUntil: 'domcontentloaded' });
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
      await page.waitForTimeout(500);
      const probe = () => page.evaluate(() => {
        const bar = document.querySelector('a[aria-label="Requital home"]').parentElement;
        const cs = getComputedStyle(bar);
        const r = bar.getBoundingClientRect();
        return { position: cs.position, top: cs.top, zIndex: cs.zIndex, rectTop: Math.round(r.top), rectH: Math.round(r.height), scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight };
      });
      const rest = await probe();
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(200);
      const scrolled = await probe();
      out.push({ vp: `${w}x${h}`, url, rest, scrolled });
      if (SHOTS && w === 390) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `topbar-${label}-${url.replace(/\W+/g, '-')}-390-scrolled.png`) });
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, 'out', `topbar-${label}.json`), JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
