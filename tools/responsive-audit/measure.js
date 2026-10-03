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
    scrollers,
    fixed,
    title: document.title,
    path: location.pathname,
  };
}

module.exports = { measurePage };
