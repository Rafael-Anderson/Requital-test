#!/usr/bin/env node
// Responsive audit harness. Local dev/prod-build servers and a freshly seeded DB only,
// never production. See README.md.
//
//   node tools/responsive-audit/audit.js --label before [--apps admin,storefront]
//        [--viewports 360x780,390x844] [--only /orders,/settings] [--no-shots]
//
// Needs: backend on AUDIT_API_URL (default :3000), admin on AUDIT_ADMIN_URL (:3001),
// storefront on AUDIT_STOREFRONT_URL (:3002).
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { seed } = require('./seed');
const { adminRoutes, storefrontRoutes } = require('./routes');
const { measurePage } = require('./measure');
const { loginAdmin } = require('./login');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

const LABEL = arg('label', 'run');
const API = process.env.AUDIT_API_URL || 'http://localhost:3000';
const ADMIN = process.env.AUDIT_ADMIN_URL || 'http://localhost:3001';
const STORE = process.env.AUDIT_STOREFRONT_URL || 'http://localhost:3002';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const VIEWPORTS = arg('viewports', '360x780,390x844,430x932,768x1024,1440x900')
  .split(',')
  .map((v) => {
    const [w, h] = v.split('x').map(Number);
    return { w, h, name: `${w}x${h}` };
  });
const APPS = arg('apps', 'admin,storefront').split(',');
const ONLY = arg('only', '') ? arg('only').split(',') : null;
const SHOTS = !flag('no-shots');
const OUT = path.join(__dirname, 'out', LABEL);
const SKELETON = '.animate-pulse, [class*="skeleton" i], [aria-busy="true"], #nprogress .bar';

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    /* some pages poll forever (orders poll every 20s); fall through to the skeleton wait */
  }
  let timedOut = false;
  try {
    await page.waitForFunction(
      (sel) => !Array.from(document.querySelectorAll(sel)).some((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden';
      }),
      SKELETON,
      { timeout: 10000 },
    );
  } catch {
    timedOut = true;
  }
  await page.waitForTimeout(400);
  return timedOut;
}

function slug(url) {
  return url.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'home';
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const fx = await seed();
  fs.writeFileSync(path.join(OUT, 'fixture.json'), JSON.stringify({ ...fx, password: '[redacted]' }, null, 2));
  const a = adminRoutes(fx);
  const s = storefrontRoutes(fx);
  let routes = [...(APPS.includes('admin') ? a.routes.filter((r) => r.kind !== 'platform') : []), ...(APPS.includes('storefront') ? s.routes : [])];
  if (ONLY) routes = routes.filter((r) => ONLY.some((o) => r.url === o || r.url.startsWith(o + '/')));
  const skipped = [...a.skipped, ...s.skipped];

  const browser = await chromium.launch({ executablePath: CHROME });
  const results = [];
  for (const vp of VIEWPORTS) {
    const mobile = vp.w <= 430;
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: mobile,
      isMobile: mobile,
      deviceScaleFactor: mobile ? 2 : 1,
      reducedMotion: 'reduce',
    });
    await loginAdmin(ctx, API, fx);
    const page = await ctx.newPage();
    for (const r of routes) {
      const base = r.app === 'admin' ? ADMIN : STORE;
      const rec = { app: r.app, url: r.url, kind: r.kind, viewport: vp.name };
      try {
        const resp = await page.goto(base + r.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        rec.status = resp ? resp.status() : null;
        rec.loadingTimedOut = await settle(page);
        rec.finalUrl = new URL(page.url()).pathname;
        Object.assign(rec, await page.evaluate(measurePage));
        if (SHOTS) {
          const file = `${r.app}-${slug(r.url)}-${vp.name}.png`;
          await page.screenshot({ path: path.join(OUT, 'shots', file), fullPage: false });
          rec.shot = `shots/${file}`;
        }
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 200);
      }
      results.push(rec);
      process.stdout.write(rec.error ? 'E' : rec.docOverflow || (rec.header && !rec.header.fullWidth) || (rec.offenders && rec.offenders.length) || (rec.clippedPrimary && rec.clippedPrimary.length) || (rec.obscuredPrimary && rec.obscuredPrimary.length) || (rec.overlapping && rec.overlapping.length) ? 'x' : '.');
    }
    await ctx.close();
  }
  await browser.close();
  process.stdout.write('\n');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ label: LABEL, generatedAt: new Date().toISOString(), viewports: VIEWPORTS.map((v) => v.name), skipped, results }, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.md'), markdown(LABEL, results, skipped));
  console.log(`wrote ${path.join(OUT, 'report.md')}`);
}

function markdown(label, results, skipped) {
  const bad = (r) => r.docOverflow || (r.header && !r.header.fullWidth) || (r.offenders && r.offenders.length > 0) || (r.clippedPrimary && r.clippedPrimary.length > 0) || (r.obscuredPrimary && r.obscuredPrimary.length > 0) || (r.overlapping && r.overlapping.length > 0);
  const lines = [`# Responsive audit: ${label}`, ''];
  const byRoute = new Map();
  for (const r of results) {
    const k = `${r.app} ${r.url}`;
    if (!byRoute.has(k)) byRoute.set(k, []);
    byRoute.get(k).push(r);
  }
  const vpNames = [...new Set(results.map((r) => r.viewport))];
  lines.push(`Routes: ${byRoute.size}. Viewports: ${vpNames.join(', ')}.`);
  const mobileVps = vpNames.filter((v) => parseInt(v, 10) <= 430);
  const failing = [...byRoute.entries()].filter(([, rs]) => rs.some((r) => mobileVps.includes(r.viewport) && bad(r)));
  lines.push(`Routes failing at 360/390/430: **${failing.length}** of ${byRoute.size}.`, '');
  lines.push('| route | ' + vpNames.join(' | ') + ' |', '|---|' + vpNames.map(() => '---').join('|') + '|');
  for (const [k, rs] of byRoute) {
    const cells = vpNames.map((v) => {
      const r = rs.find((x) => x.viewport === v);
      if (!r) return '';
      if (r.error) return 'ERR';
      const bits = [];
      if (r.docOverflow) bits.push(`doc +${r.overflowPx}px`);
      if (r.header && !r.header.fullWidth) bits.push(`header ${r.header.w}/${r.innerWidth}`);
      if (r.offenders.length) bits.push(`${r.offenders.length} past`);
      if (r.clippedPrimary && r.clippedPrimary.length) bits.push(`${r.clippedPrimary.length} clipped`);
      if (r.obscuredPrimary && r.obscuredPrimary.length) bits.push(`${r.obscuredPrimary.length} obscured`);
      if (r.overlapping && r.overlapping.length) bits.push(`${r.overlapping.length} overlap`);
      if (r.loadingTimedOut) bits.push('loading?');
      return bits.length ? bits.join(', ') : 'ok';
    });
    lines.push(`| ${k} | ${cells.join(' | ')} |`);
  }
  lines.push('', '## Offenders at 360/390/430 (elements past the viewport, outside a sideways scroller)', '');
  for (const [k, rs] of failing) {
    for (const r of rs.filter((x) => mobileVps.includes(x.viewport) && bad(x))) {
      lines.push(`### ${k} @ ${r.viewport}${r.docOverflow ? `: document ${r.docScrollWidth}px vs ${r.innerWidth}px` : ''}${r.header && !r.header.fullWidth ? `, header ${r.header.w}px` : ''}`);
      for (const o of r.offenders.slice(0, 6)) lines.push(`- \`${o.el}\` x=${o.box.x} w=${o.box.w} right=${o.box.right}`);
      if (r.offenders.length > 6) lines.push(`- (+${r.offenders.length - 6} more)`);
      for (const o of (r.obscuredPrimary || []).slice(0, 6)) lines.push(`- obscured \`${o.el}\` by fixed \`${o.by}\``);
      for (const o of (r.overlapping || []).slice(0, 6)) lines.push(`- overlap \`${o.a}\` x \`${o.b}\` ${o.w}x${o.h}`);
      for (const o of (r.clippedPrimary || []).slice(0, 6)) lines.push(`- clipped \`${o.el}\` cut ${o.cutX}x${o.cutY} by \`${o.clippedBy}\``);
    }
  }
  lines.push('', '## Skipped (no fixture)', '', ...skipped.map((s) => `- ${s.app} \`${s.file}\`: ${s.reason}`));
  return lines.join('\n') + '\n';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
