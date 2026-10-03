// Real touch-swipe check: needs a context created with { hasTouch: true, isMobile: true }.
// Uses Chromium's Input.synthesizeScrollGesture (a genuine touch gesture, not scrollTo()).
// Returns { found, container, before, after, scrolled } for the nearest horizontally
// scrollable element at/above the given selector (or the document if none).
async function swipeHorizontally(page, selector, { distance = -260 } = {}) {
  const handle = await page.$(selector);
  if (!handle) return { found: false, selector };
  await handle.scrollIntoViewIfNeeded();
  const info = await handle.evaluate((el) => {
    let t = el;
    const scrollable = (e) => {
      const o = getComputedStyle(e).overflowX;
      return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1;
    };
    while (t && t !== document.body && !scrollable(t)) t = t.parentElement;
    const target = t && t !== document.body ? t : null;
    const r = (target || el).getBoundingClientRect();
    const d = (e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 5).join('.') : ''}`;
    return {
      hasScroller: !!target,
      container: target ? d(target) : 'document',
      x: r.left + Math.min(r.width / 2, 200),
      y: r.top + Math.min(r.height / 2, 120),
      scrollWidth: target ? target.scrollWidth : document.documentElement.scrollWidth,
      clientWidth: target ? target.clientWidth : window.innerWidth,
    };
  });
  const read = () =>
    handle.evaluate((el) => {
      let t = el;
      const scrollable = (e) => {
        const o = getComputedStyle(e).overflowX;
        return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1;
      };
      while (t && t !== document.body && !scrollable(t)) t = t.parentElement;
      return t && t !== document.body ? t.scrollLeft : window.scrollX;
    });
  const before = await read();
  const cdp = await page.context().newCDPSession(page);
  // A real touch drag: touchStart, many touchMove steps, touchEnd (Input.dispatchTouchEvent).
  // Input.synthesizeScrollGesture was tried first and did not move even a plain overflow-x:auto
  // control in this headless build, so the control element in diagnose2.js is what proves this works.
  const x0 = Math.round(info.x), y0 = Math.round(info.y);
  const steps = 14;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + Math.round((distance * i) / steps), y: y0 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  const after = await read();
  await cdp.detach();
  return { found: true, selector, ...info, before, after, scrolled: Math.abs(after - before) > 1 };
}

module.exports = { swipeHorizontally };
