#!/usr/bin/env node
// Theme-builder PREVIEW audit. Two ways to look at the storefront-in-preview:
//   A. the real admin builder (admin/app/theme/[themeId]/builder) with its Mobile and Desktop device toggles, measuring
//      the document INSIDE the iframe (cross-origin frames are reachable through Playwright);
//   B. the iframe's own URL (`?preview=true&themeId=&previewToken=`) loaded directly at 390 and 1440, for home, a
//      collection and a product, then a double-click selection (the preview-only outline + floating toolbar) re-measured.
// The seeded fixture comes from a previous audit run (out/<label>/fixture.json, created with AUDIT_TEMPLATE).
//   node tools/responsive-audit/preview.js --fixture out/before-atelier/fixture.json --label before-atelier
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { measurePage } = require('./measure');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const API = process.env.AUDIT_API_URL || 'http://localhost:3104';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3204';
const STORE = process.env.AUDIT_STOREFRONT_URL || 'http://localhost:3304';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fx = JSON.parse(fs.readFileSync(arg('fixture'), 'utf8'));
const LABEL = arg('label', 'preview');
const OUT = path.join(__dirname, 'out', `preview-${LABEL}`);
const PASSWORD = 'Zx9!audit-Fixture-pw';

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    /* */
  }
  try {
    await page.waitForFunction(() => !document.querySelector('.animate-pulse, [aria-busy="true"], #nprogress .bar'), null, { timeout: 8000 });
  } catch {
    /* */
  }
  await page.waitForSelector('header', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

const summarise = (m) => ({
  doc: `${m.docScrollWidth}/${m.innerWidth}`,
  docOverflow: m.docOverflow,
  overflowPx: m.overflowPx,
  offenders: m.offenders.map((o) => o.el + ` x=${o.box.x} w=${o.box.w}`),
  clippedPrimary: (m.clippedPrimary || []).map((o) => `${o.el} cut ${o.cutX}x${o.cutY} by ${o.clippedBy}`),
  obscuredPrimary: (m.obscuredPrimary || []).map((o) => `${o.el} by ${o.by}`),
  clippedPast: (m.clipped || []).filter((c) => !/^(svg|path|circle|g)\b/.test(c.el)).map((c) => `${c.el} by ${c.clippedBy}`),
});

async function main() {
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const results = [];
  const loginCtx = await browser.newContext();
  const lr = await loginCtx.request.post(`${API}/auth/login`, { data: { email: fx.email, password: PASSWORD } });
  if (!lr.ok()) throw new Error(`login ${lr.status()}`);
  const state = await loginCtx.storageState();
  // preview token for B (cookie jar + csrf from the login response)
  const csrf = lr.headers()['x-csrf-token'] || '';
  const tr = await loginCtx.request.post(`${API}/themes/${fx.themeId}/preview-token`, { data: {}, headers: { 'X-CSRF-Token': csrf } });
  const token = tr.ok() ? (await tr.json()).previewToken : null;
  await loginCtx.close();

  // ---- A: through the admin builder
  for (const device of ['Mobile', 'Desktop']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', storageState: state });
    const page = await ctx.newPage();
    const rec = { mode: 'A admin builder', device, url: `/theme/${fx.themeId}/builder` };
    try {
      await page.goto(`${ADMIN}/theme/${fx.themeId}/builder`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('iframe', { timeout: 30000 });
      await page.getByRole('button', { name: device, exact: true }).click();
      await page.waitForTimeout(1500);
      const handle = await page.$('iframe');
      const frame = await handle.contentFrame();
      await frame.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1500);
      rec.iframeBox = await handle.boundingBox();
      const m = await frame.evaluate(measurePage);
      Object.assign(rec, summarise(m));
      await handle.screenshot({ path: path.join(OUT, 'shots', `A-${device}.png`) });
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 240);
    }
    results.push(rec);
    await ctx.close();
  }

  // ---- B: the iframe URL directly
  const pages = [
    ['home', ''],
    ['collection', `/collections/${fx.collectionSlugs[0]}`],
    ['product', `/products/${fx.products[0].slug}`],
  ];
  for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
    for (const [name, p] of pages) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, reducedMotion: 'reduce', isMobile: vp.w < 500, hasTouch: vp.w < 500, deviceScaleFactor: vp.w < 500 ? 2 : 1 });
      const page = await ctx.newPage();
      const rec = { mode: 'B iframe url', device: `${vp.w}`, url: `${p || '/'}` };
      try {
        await page.goto(`${STORE}/${fx.subdomain}${p}?preview=true&themeId=${fx.themeId}${token ? `&previewToken=${encodeURIComponent(token)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await settle(page);
        const m = await page.evaluate(measurePage);
        Object.assign(rec, summarise(m));
        await page.screenshot({ path: path.join(OUT, 'shots', `B-${name}-${vp.w}.png`) });
        // preview-only overlays: select the first editable element (double click) and re-measure
        const ed = await page.$('[data-requital-editable="true"]');
        rec.editableFound = !!ed;
        if (ed) {
          await ed.scrollIntoViewIfNeeded();
          await ed.dblclick({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(500);
          const m2 = await page.evaluate(measurePage);
          rec.afterSelect = summarise(m2);
          await page.screenshot({ path: path.join(OUT, 'shots', `B-${name}-${vp.w}-selected.png`) });
        }
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 240);
      }
      results.push(rec);
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ label: LABEL, results }, null, 2));
  const lines = [`# Preview audit ${LABEL}`, ''];
  for (const r of results) {
    const flags = [];
    if (r.docOverflow) flags.push(`DOC +${r.overflowPx}`);
    if (r.offenders && r.offenders.length) flags.push(`${r.offenders.length} past`);
    if (r.clippedPrimary && r.clippedPrimary.length) flags.push(`${r.clippedPrimary.length} clipped`);
    if (r.obscuredPrimary && r.obscuredPrimary.length) flags.push(`${r.obscuredPrimary.length} obscured`);
    lines.push(`- ${r.mode} / ${r.device} ${r.url}: ${r.error ? 'ERROR ' + r.error : flags.length ? flags.join(', ') : 'ok'} (doc ${r.doc})`);
    for (const k of ['offenders', 'clippedPrimary', 'obscuredPrimary']) for (const o of r[k] || []) lines.push(`    - ${k}: ${o}`);
    if (r.afterSelect) {
      const a = r.afterSelect;
      lines.push(`    - after select: doc ${a.doc}${a.docOverflow ? ' OVERFLOW' : ''}, past ${a.offenders.length}, clipped ${a.clippedPrimary.length}, obscured ${a.obscuredPrimary.length}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
