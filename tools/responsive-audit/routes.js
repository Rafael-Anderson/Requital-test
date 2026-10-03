// Enumerates every admin and storefront page.tsx and fills dynamic segments from the
// seeded fixture. Routes that need data the seed does not create are returned in
// `skipped` with the reason, so the report states what it did NOT cover.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'page.tsx') out.push(p);
  }
  return out;
}

function segmentsOf(file, appDir) {
  const rel = path.relative(appDir, path.dirname(file));
  return rel === '' ? [] : rel.split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
}

function fill(segments, resolver) {
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (/^\[\.\.\..*\]$/.test(seg)) return { skip: `catch-all segment ${seg}` };
    const m = /^\[(.*)\]$/.exec(seg);
    if (!m) {
      out.push(seg);
      continue;
    }
    const v = resolver(segments.slice(0, i), m[1]);
    if (v === undefined || v === null) return { skip: `no fixture for [${m[1]}] under /${segments.slice(0, i).join('/')}` };
    out.push(String(v));
  }
  return { url: '/' + out.join('/') };
}

function adminRoutes(fx) {
  const appDir = path.join(ROOT, 'admin', 'app');
  const routes = [];
  const skipped = [];
  for (const f of walk(appDir)) {
    const segs = segmentsOf(f, appDir);
    const top = segs[0];
    const isPlatform = top === 'platform';
    const preAuth = ['login', 'signup', 'forgot-password', 'reset-password', 'verify-email', 'accept-invite', 'impersonation-ended'].includes(top);
    const r = fill(segs, (prefix, name) => {
      const p = prefix.join('/');
      if (/^orders/.test(p) || /^history/.test(p)) return fx.orderIds[0];
      if (/^(inventory|products)/.test(p) && name === 'id') return fx.products[0].id;
      if (/^collections/.test(p)) return fx.collectionIds[0];
      if (/^settings\/outlets|^outlets/.test(p)) return fx.outletId;
      if (/^discounts/.test(p) && fx.discountId) return fx.discountId;
      return undefined;
    });
    if (r.skip) skipped.push({ app: 'admin', file: path.relative(ROOT, f), reason: r.skip });
    else routes.push({ app: 'admin', url: r.url, kind: isPlatform ? 'platform' : preAuth ? 'preauth' : 'auth' });
  }
  return { routes: dedupe(routes), skipped };
}

function storefrontRoutes(fx) {
  const appDir = path.join(ROOT, 'storefront', 'app');
  const routes = [];
  const skipped = [];
  for (const f of walk(appDir)) {
    const segs = segmentsOf(f, appDir);
    const r = fill(segs, (prefix, name) => {
      const p = prefix.join('/');
      if (name === 'shop') return fx.subdomain;
      if (/products$/.test(p)) return fx.products[0].slug;
      if (/collections$/.test(p)) return fx.collectionSlugs[0];
      if (/policies$/.test(p)) return 'TERMS';
      if (/orders$/.test(p) && fx.orderTrackingTokens[0]) return fx.orderTrackingTokens[0];
      return undefined;
    });
    if (r.skip) skipped.push({ app: 'storefront', file: path.relative(ROOT, f), reason: r.skip });
    else routes.push({ app: 'storefront', url: r.url, kind: 'public' });
  }
  return { routes: dedupe(routes), skipped };
}

function dedupe(routes) {
  const seen = new Set();
  return routes.filter((r) => (seen.has(r.url) ? false : seen.add(r.url))).sort((a, b) => a.url.localeCompare(b.url));
}

module.exports = { adminRoutes, storefrontRoutes };
