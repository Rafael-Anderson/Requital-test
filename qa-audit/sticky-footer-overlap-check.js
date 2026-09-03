const puppeteer = require('puppeteer');
const path = require('path');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type="submit"]')]);

  await page.goto(`${ADMIN}/products/1/edit`, { waitUntil: 'networkidle2' });
  await sleep(1000);

  // Jump to Organization step via the stepper
  const orgBtn = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Organization')),
  );
  const orgEl = orgBtn.asElement();
  if (orgEl) await orgEl.click();
  await sleep(600);

  // Scroll so "Add variants" is near the bottom of the viewport (where the sticky footer lives)
  const info = await page.evaluate(() => {
    const addVariantsBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Add variants'),
    );
    if (!addVariantsBtn) return { found: false };
    addVariantsBtn.scrollIntoView({ block: 'end' }); // put it near viewport bottom
    return { found: true };
  });
  console.log('Add variants button found + scrolled to bottom:', info.found);
  await sleep(300);

  const result = await page.evaluate(() => {
    const addVariantsBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Add variants'),
    );
    const footer = Array.from(document.querySelectorAll('div')).find(
      (d) => d.className.includes('sticky') && d.className.includes('bottom-0') && d.textContent.includes('Save changes'),
    );
    if (!addVariantsBtn) return { error: 'no Add variants button' };
    const r = addVariantsBtn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const topElement = document.elementFromPoint(cx, cy);
    return {
      addVariantsRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      footerRect: footer ? (() => { const fr = footer.getBoundingClientRect(); return { x: fr.x, y: fr.y, w: fr.width, h: fr.height }; })() : null,
      clickPoint: { cx, cy },
      elementActuallyAtThatPoint: topElement ? topElement.outerHTML.slice(0, 200) : null,
      isAddVariantsButtonItself: topElement === addVariantsBtn,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(SHOT_DIR, 'products-sticky-footer-overlap-scrolled.png') });
  await browser.close();
})();
