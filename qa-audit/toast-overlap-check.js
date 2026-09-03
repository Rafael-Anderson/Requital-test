const puppeteer = require('puppeteer');
const path = require('path');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, tag, text) {
  const handle = await page.evaluateHandle(
    (tag, text) => Array.from(document.querySelectorAll(tag)).find((el) => el.textContent && el.textContent.includes(text)) || null,
    tag, text,
  );
  const el = handle.asElement();
  if (el) { await el.click(); return true; }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type="submit"]')]);

  await page.goto(`${ADMIN}/products/new`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await page.type('input', 'Toast Overlap Test');
  await clickByText(page, 'button', 'Next');
  await sleep(400);
  await clickByText(page, 'button', 'Next');
  await sleep(400);
  // On step3 (Organization), submit with nothing else filled -> jumps back to Pricing w/ toast
  await clickByText(page, 'button', 'Create product');
  await sleep(300); // catch toast while visible, before its own auto-dismiss

  const rects = await page.evaluate(() => {
    const toast = document.querySelector('.fixed.bottom-4.right-4');
    const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Next' || b.textContent.trim() === 'Create product');
    const nextBtn = buttons[0];
    const tr = toast ? toast.getBoundingClientRect() : null;
    const br = nextBtn ? nextBtn.getBoundingClientRect() : null;
    return { toastRect: tr && { x: tr.x, y: tr.y, w: tr.width, h: tr.height }, btnRect: br && { x: br.x, y: br.y, w: br.width, h: br.height }, btnText: nextBtn && nextBtn.textContent.trim() };
  });
  console.log(JSON.stringify(rects, null, 2));
  await page.screenshot({ path: path.join(SHOT_DIR, 'products-toast-overlap-proof.png') });
  await browser.close();
})();
