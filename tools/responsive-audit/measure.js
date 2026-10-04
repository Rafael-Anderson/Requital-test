// The in-page measurement. Serialised into the page by Playwright, so it must be
// self-contained. Returns plain JSON.
function measurePage() {
  const de = document.documentElement;
  // Layout viewport width (the configured device width). window.innerWidth is NOT usable on a
  // mobile page that overflows: Chrome zooms the visual viewport out to fit the content, so
  // innerWidth grows to the content width while the layout viewport (and the header) stay put.
  const vw = de.clientWidth;
  const visible = (el, r) => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  };
  const clipsX = (o) => o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip';
  const scrollsX = (o) => o === 'auto' || o === 'scroll';
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 8).join(' ') : '';
    const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls.replace(/\s+/g, '.') : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) });

  // nearest ancestor that clips horizontally; 'scroll' kind if it genuinely scrolls
  const ancestorClip = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (clipsX(o)) return { el: p, scrolls: scrollsX(o) };
    }
    return null;
  };
  const insideFixed = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true;
    return false;
  };

  const all = Array.from(document.body.querySelectorAll('*'));
  const past = new Set();
  const clipped = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || insideFixed(el)) continue;
    const sticky = getComputedStyle(el).position === 'sticky';
    if (!(r.right > vw + 1 || r.left < -1)) continue;
    const clip = ancestorClip(el);
    if (clip && clip.scrolls) continue; // legitimate sideways scroller
    if (clip) {
      clipped.push({ el: describe(el), box: box(r), clippedBy: describe(clip.el) });
      continue;
    }
    if (el.tagName === 'svg' || el.closest('svg')) continue;
    past.add(el);
    void sticky;
  }
  const offenders = [];
  for (const el of past) {
    if (el.parentElement && past.has(el.parentElement)) continue; // keep topmost only
    offenders.push({ el: describe(el), box: box(el.getBoundingClientRect()) });
  }

  // Primary elements (links, buttons, form controls, headings, prices, images) that are PARTLY cut off by an
  // overflow hidden|clip ancestor (any axis) while visible in the viewport. `clipped` above only sees
  // elements past the viewport edge; this sees a logo or CTA sliced inside the page. Elements fully outside
  // their clipper (an off-canvas slide) are intended and skipped; so is text under text-overflow: ellipsis.
  const PRIMARY = 'a[href],button,input,select,textarea,h1,h2,h3,img,[class*="price" i]';
  const clippedPrimary = [];
  for (const el of document.body.querySelectorAll(PRIMARY)) {
    if (el.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > vw) continue;
    if (el.closest('[aria-hidden="true"],[inert],.sr-only')) continue;
    for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const cx = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const cy = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!cx && !cy) continue;
      if (cs.textOverflow === 'ellipsis') break;
      const pr = p.getBoundingClientRect();
      const inter = r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top;
      if (!inter) break;
      const cutX = cx ? Math.max(0, pr.left - r.left, r.right - pr.right) : 0;
      const cutY = cy ? Math.max(0, pr.top - r.top, r.bottom - pr.bottom) : 0;
      if (cutX > 2 || cutY > 2) {
        clippedPrimary.push({ el: describe(el), box: box(r), clippedBy: describe(p), clipBox: box(pr), cutX: Math.round(cutX), cutY: Math.round(cutY) });
        break;
      }
    }
  }

  // Primary elements whose own centre/edge points are covered by an unrelated FIXED element (a floating button over
  // the logo, a bar over a link). The cookie banner is a transient overlay and is excluded on purpose.
  const obscuredPrimary = [];
  for (const el of document.body.querySelectorAll(PRIMARY)) {
    if (el.closest('svg') || el.closest('[aria-hidden="true"],[inert],.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > vw) continue;
    let hit = null;
    for (const fx of [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
      for (const fy of [0.3, 0.7]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < 0 || x >= vw || y < 0 || y >= window.innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (!top || top === el || el.contains(top) || top.contains(el)) continue;
        if (top.closest('[data-cookie-banner]') || !insideFixed(top)) continue;
      // a fixed element anchored in the lower half (bottom nav, floating buttons) always covers part of whatever
      // scrolls under it; that is what fixed bars are. Only covers in the upper half count as defects.
      let fx0 = top;
      while (fx0 && getComputedStyle(fx0).position !== 'fixed') fx0 = fx0.parentElement;
      if (fx0 && fx0.getBoundingClientRect().top > window.innerHeight / 2) continue;
        hit = { el: describe(el), box: box(r), by: describe(top), at: Math.round(x) };
        break;
      }
      if (hit) break;
    }
    if (hit) obscuredPrimary.push(hit);
  }

  // Interactive elements that overlap each other (a nav row laid over the logo, icons on top of a link): pairs of
  // in-flow interactive boxes that intersect by more than a few px and where neither contains the other. Absolutely
  // positioned and fixed ones are overlays by design (badges, the wishlist heart) and are covered by obscuredPrimary.
  const INTERACTIVE = 'a[href],button,input,select,textarea';
  const boxes = [];
  for (const el of document.body.querySelectorAll(INTERACTIVE)) {
    if (el.closest('svg') || el.closest('[aria-hidden="true"],[inert],.sr-only') || insideFixed(el)) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r) || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > vw) continue;
    let overlay = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === 'absolute') overlay = true;
    if (overlay) continue;
    const clip = ancestorClip(el);
    if (clip && clip.scrolls) continue; // inside a sideways scroller: only part is on screen
    boxes.push({ el, r });
  }
  const overlapping = [];
  for (let i = 0; i < boxes.length && overlapping.length < 20; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 4 && h > 4) {
        overlapping.push({ a: describe(a.el), b: describe(b.el), w: Math.round(w), h: Math.round(h) });
        break;
      }
    }
  }

  const scrollers = [];
  for (const el of all) {
    const o = getComputedStyle(el).overflowX;
    if (scrollsX(o) && el.scrollWidth > el.clientWidth + 1) {
      const r = el.getBoundingClientRect();
      if (visible(el, r)) scrollers.push({ el: describe(el), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, box: box(r) });
    }
  }

  const fixed = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (visible(el, r)) fixed.push({ el: describe(el), box: box(r), bottomGap: Math.round(window.innerHeight - r.bottom) });
  }

  const logo = document.querySelector('a[aria-label="Requital home"]'); // admin TopBar is a plain div
  const header = document.querySelector('header') || (logo && logo.parentElement) || null;
  const hr = header ? header.getBoundingClientRect() : null;
  const body = getComputedStyle(document.body);
  const html = getComputedStyle(de);
  return {
    innerWidth: vw,
    windowInnerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    docOverflow: de.scrollWidth > vw + 1,
    overflowPx: Math.max(0, de.scrollWidth - vw),
    header: hr ? { ...box(hr), fullWidth: Math.abs(hr.width - vw) <= 1 && hr.left >= -1 } : null,
    htmlBg: html.backgroundColor,
    bodyBg: body.backgroundColor,
    colorScheme: html.colorScheme,
    offenders,
    clipped: clipped.slice(0, 12),
    clippedPrimary: clippedPrimary.slice(0, 20),
    obscuredPrimary: obscuredPrimary.slice(0, 20),
    overlapping,
    scrollers,
    fixed,
    title: document.title,
    path: location.pathname,
  };
}

module.exports = { measurePage };
