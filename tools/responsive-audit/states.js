#!/usr/bin/env node
// Interaction-state audit for one seeded storefront shop: keyboard focus ring visibility (pixel diff of the
// focused vs blurred element, plus the contrast of the changed pixels), whether the focused element is
// obscured by a fixed bar, and hover (layout shift of the element and its neighbours, text contrast after
// hover). Local servers only. See README.md.
//
//   node tools/responsive-audit/states.js --fixture out/before-atelier/fixture.json --label before-atelier \
//        [--viewports 390x844,1440x900] [--pages home,pdp,checkout]
const fs = require('fs');
const path = require('path');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const sharp = require('../../admin/node_modules/sharp');

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const STORE = process.env.AUDIT_STOREFRONT_URL || 'http://localhost:3304';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fx = JSON.parse(fs.readFileSync(arg('fixture'), 'utf8'));
const LABEL = arg('label', 'states');
const OUT = path.join(__dirname, 'out', `states-${LABEL}`);
const VIEWPORTS = arg('viewports', '390x844,1440x900').split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { w, h, name: `${w}x${h}` };
});
const PAGES = arg('pages', 'home,pdp,checkout').split(',');
const MAX_TABS = Number(arg('tabs', 70));

// ---- in-page helpers (serialised into the page) ----
function pageHelpers() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const paint = (color, base) => {
    // composite `color` over the opaque `base` [r,g,b]; returns [r,g,b]
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    cx.fillRect(0, 0, 1, 1);
    cx.fillStyle = color;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const effectiveBg = (el) => {
    const chain = [];
    for (let p = el; p; p = p.parentElement) chain.push(p);
    let base = [255, 255, 255];
    let unknown = false;
    for (let i = chain.length - 1; i >= 0; i--) {
      const cs = getComputedStyle(chain[i]);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') unknown = true;
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') base = paint(cs.backgroundColor, base);
    }
    return { rgb: base, unknown };
  };
  const textContrast = (el) => {
    const { rgb, unknown } = effectiveBg(el);
    let op = 1;
    for (let p = el; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
    const cs = getComputedStyle(el);
    const fg = paint(cs.color, rgb);
    const fgOp = op < 1 ? rgb.map((b, i) => Math.round(b + (fg[i] - b) * op)) : fg;
    return { ratio: Math.round(ratio(fgOp, rgb) * 100) / 100, bg: rgb, fg: fgOp, unknownBg: unknown };
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    const txt = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  };
  return { textContrast, describe, rectOf, effectiveBg, ratio };
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    /* polling pages */
  }
  try {
    await page.waitForFunction(() => !document.querySelector('.animate-pulse, [aria-busy="true"], #nprogress .bar'), null, { timeout: 8000 });
  } catch {
    /* fall through */
  }
  await page.waitForTimeout(500);
}

async function clipShot(page, rect, vp) {
  const pad = 8;
  const x = Math.max(0, Math.floor(rect[0] - pad));
  const y = Math.max(0, Math.floor(rect[1] - pad));
  const w = Math.min(vp.w - x, Math.ceil(rect[2] + pad * 2));
  const h = Math.min(vp.h - y, Math.ceil(rect[3] + pad * 2));
  if (w < 2 || h < 2) return null;
  return page.screenshot({ clip: { x, y, width: w, height: h } });
}

async function diffRing(a, b) {
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { diff: -1, maxRatio: 0 };
  const ch = ra.info.channels;
  let diff = 0;
  let maxRatio = 1;
  const lum = (r, g, bl) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  for (let i = 0; i < ra.data.length; i += ch) {
    const d = Math.max(Math.abs(ra.data[i] - rb.data[i]), Math.abs(ra.data[i + 1] - rb.data[i + 1]), Math.abs(ra.data[i + 2] - rb.data[i + 2]));
    if (d > 24) {
      diff++;
      const l1 = lum(ra.data[i], ra.data[i + 1], ra.data[i + 2]);
      const l2 = lum(rb.data[i], rb.data[i + 1], rb.data[i + 2]);
      const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (r > maxRatio) maxRatio = r;
    }
  }
  return { diff, maxRatio: Math.round(maxRatio * 100) / 100 };
}

async function tabAudit(page, vp, tag, shotDir) {
  const stops = [];
  const seen = new Set();
  await page.evaluate(() => {
    if (document.activeElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => document.body.focus && document.body.focus());
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const info = await page.evaluate(
      ({ pageHelpers: ph }) => {
        const H = new Function(`return (${ph})()`)();
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const top = document.elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
        const obscured = !(top === el || el.contains(top) || (top && top.contains(el) && top !== document.documentElement && top !== document.body && false));
        return {
          desc: H.describe(el),
          key: H.describe(el) + '@' + H.rectOf(el).join(','),
          rect: H.rectOf(el),
          inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
          obscured,
          obscuredBy: obscured && top ? H.describe(top) : null,
          outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          boxShadow: cs.boxShadow === 'none' ? null : cs.boxShadow.slice(0, 80),
          contrast: H.textContrast(el).ratio,
          fixedAncestor: (() => {
            for (let p = el; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true;
            return false;
          })(),
        };
      },
      { pageHelpers: pageHelpers.toString() },
    );
    if (!info) {
      if (stops.length > 3 && i > 5) {
        // wrapped to browser chrome / document: stop
        break;
      }
      continue;
    }
    if (seen.has(info.key)) break;
    seen.add(info.key);
    if (info.inViewport) {
      const a = await clipShot(page, info.rect, vp);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.waitForTimeout(40);
      const b = await clipShot(page, info.rect, vp);
      if (a && b) {
        const d = await diffRing(a, b);
        info.ringDiffPx = d.diff;
        info.ringContrast = d.maxRatio;
        info.ringInvisible = !info.obscured && d.diff < 12;
        info.ringWeak = !info.ringInvisible && d.maxRatio < 3;
        if ((info.ringInvisible || info.ringWeak || info.obscured) && shotDir) {
          const f = `${tag}-tab${stops.length}.png`;
          fs.writeFileSync(path.join(shotDir, f), a);
          info.shot = f;
        }
      }
    }
    stops.push(info);
  }
  return stops;
}

async function hoverAudit(page, vp) {
  const res = [];
  const count = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel)).filter((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden="true"],[inert]');
    });
    window.__hoverEls = els.slice(0, 80);
    return window.__hoverEls.length;
  }, FOCUSABLE);
  for (let i = 0; i < count; i++) {
    const before = await page.evaluate(
      ({ i, ph }) => {
        const H = new Function(`return (${ph})()`)();
        const el = window.__hoverEls[i];
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        const par = el.parentElement;
        const neigh = par ? Array.from(par.children).map((c) => H.rectOf(c)) : [];
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const top = document.elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
        const hit = top === el || el.contains(top);
        return { desc: H.describe(el), rect: H.rectOf(el), parent: par ? H.rectOf(par) : null, neigh, tc: H.textContrast(el), hit, cx, cy, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight };
      },
      { i, ph: pageHelpers.toString() },
    );
    if (!before.hit || before.rect[2] < 2) continue;
    await page.mouse.move(before.cx, before.cy);
    await page.waitForTimeout(120);
    const after = await page.evaluate(
      ({ i, ph }) => {
        const H = new Function(`return (${ph})()`)();
        const el = window.__hoverEls[i];
        const par = el.parentElement;
        return { rect: H.rectOf(el), parent: par ? H.rectOf(par) : null, neigh: par ? Array.from(par.children).map((c) => H.rectOf(c)) : [], tc: H.textContrast(el), docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight };
      },
      { i, ph: pageHelpers.toString() },
    );
    const moved = (a, b) => a && b && a.some((v, k) => Math.abs(v - b[k]) > 0.6);
    // Layout shift = the PARENT or a SIBLING moved or resized. The hovered element's own box changing is a
    // transform (scale, lift, tilt) by design, not a reflow.
    const shift = moved(before.parent, after.parent) || before.neigh.some((n, k) => (before.rect.every((v, j) => v === n[j]) ? false : moved(n, after.neigh[k])));
    res.push({
      desc: before.desc,
      shift,
      shiftRect: shift ? { before: before.rect, after: after.rect } : null,
      docGrew: after.docW > before.docW + 1,
      contrastBefore: before.tc.ratio,
      contrastAfter: after.tc.ratio,
      lowAfter: after.tc.ratio < 3 && !after.tc.unknownBg,
      dropped: after.tc.ratio + 1 < before.tc.ratio && after.tc.ratio < 4.5 && !after.tc.unknownBg,
    });
    await page.mouse.move(0, 0);
  }
  return res;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const shotDir = path.join(OUT, 'shots');
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const results = [];
  for (const vp of VIEWPORTS) {
    const mobile = vp.w <= 430;
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const base = `${STORE}/${fx.subdomain}`;
      let url = base;
      if (pg === 'pdp') url = `${base}/products/${fx.products[0].slug}`;
      if (pg === 'checkout' || pg === 'cart') {
        // seed a cart, then open the page
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.evaluate(
          ({ slug, f }) => {
            localStorage.setItem(
              `requital_storefront_cart:${slug}`,
              JSON.stringify({ outletId: f.outletId, discountCode: null, giftCardCode: null, items: f.products.slice(0, 2).map((p, i) => ({ productId: p.id, name: p.name, price: 40 + i * 15, thumbnail: '', quantity: 1 + i, maxStock: null })) }),
            );
          },
          { slug: fx.subdomain, f: fx },
        );
        url = `${base}/${pg}`;
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(page);
      const tag = `${pg}-${vp.name}`;
      const rec = { page: pg, viewport: vp.name, url };
      try {
        rec.tabs = await tabAudit(page, vp, tag, shotDir);
        await page.evaluate(() => {
          if (document.activeElement) document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        if (!mobile) rec.hovers = await hoverAudit(page, vp);
        else rec.hovers = await hoverAudit(page, vp); // touch contexts still honour mouse.move in Chromium
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 300);
      }
      results.push(rec);
      process.stdout.write(rec.error ? 'E' : '.');
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ label: LABEL, results }, null, 2));
  const lines = [`# States audit ${LABEL}`, ''];
  for (const r of results) {
    lines.push(`## ${r.page} @ ${r.viewport}`);
    if (r.error) lines.push(`ERROR ${r.error}`);
    const t = r.tabs || [];
    lines.push(`tab stops: ${t.length}; ring invisible: ${t.filter((x) => x.ringInvisible).length}; weak: ${t.filter((x) => x.ringWeak).length}; obscured: ${t.filter((x) => x.obscured).length}`);
    for (const x of t.filter((x) => x.ringInvisible || x.ringWeak || x.obscured)) lines.push(`- ${x.ringInvisible ? 'NO-RING' : x.ringWeak ? 'WEAK-RING' : 'OBSCURED'} ${x.desc} outline=${x.outline} diff=${x.ringDiffPx} contrast=${x.ringContrast}${x.obscuredBy ? ' by ' + x.obscuredBy : ''}`);
    const h = r.hovers || [];
    lines.push(`hover checked: ${h.length}; shifts: ${h.filter((x) => x.shift).length}; low contrast after: ${h.filter((x) => x.lowAfter).length}; dropped: ${h.filter((x) => x.dropped).length}`);
    for (const x of h.filter((x) => x.shift || x.lowAfter || x.dropped || x.docGrew)) lines.push(`- HOVER ${x.shift ? 'SHIFT ' : ''}${x.lowAfter ? 'LOW ' : ''}${x.dropped ? 'DROP ' : ''}${x.docGrew ? 'DOCGREW ' : ''}${x.desc} ${x.contrastBefore}->${x.contrastAfter}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
  console.log(`\nwrote ${path.join(OUT, 'report.md')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
