// Single consolidated run: login once, seed a real order (via draft order ->
// complete) and a real customer, then screenshot Dashboard/Orders(kanban,
// detail)/History(detail)/Draft Orders/Abandoned Carts/Customers(detail) at
// 1440x900 and 390x844. Logs console errors / pageerrors / HTTP>=400 for every page.
const puppeteer = require('puppeteer');
const path = require('path');
const SHOT = path.join(__dirname, 'screenshots');
const PROFILE = path.join(__dirname, 'chrome-profile');
const ADMIN = 'http://localhost:3001';

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function fillByLabel(page, labelText, value) {
  return page.evaluate((labelText, value, fnStr) => {
    const setNativeValue = eval(`(${fnStr})`);
    const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent.trim().startsWith(labelText));
    if (!label) return 'no-label:' + labelText;
    const input = document.getElementById(label.htmlFor);
    if (!input) return 'no-input:' + labelText;
    setNativeValue(input, value);
    return 'ok';
  }, labelText, value, setNativeValue.toString());
}
function attach(page, label) {
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${label}] CONSOLE ERROR:`, m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log(`[${label}] PAGE ERROR:`, e.message.slice(0, 200)));
  page.on('response', (r) => { if (r.status() >= 400) console.log(`[${label}] HTTP ${r.status()}:`, r.url()); });
}
async function loginWithRetry(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
    const emailInput = await page.$('input[type="email"]');
    if (!emailInput) { console.log('already authenticated'); return true; }
    await page.type('input[type="email"]', 'admin@test-shop.com');
    await page.type('input[type="password"]', 'dev-password-123');
    await page.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2000));
    const stillOnLogin = page.url().includes('/login');
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (!stillOnLogin) { console.log('login ok on attempt', attempt + 1); return true; }
    if (/too many|429/i.test(bodyText)) {
      console.log(`login throttled, attempt ${attempt + 1}, waiting...`);
      await new Promise((r) => setTimeout(r, 8000));
    } else {
      console.log('login failed, body:', bodyText.slice(0, 200));
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  return false;
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT, name), fullPage: true });
  console.log('  shot:', name);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', userDataDir: PROFILE });
  const page = await browser.newPage();
  attach(page, 'main');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/`, { waitUntil: 'networkidle2' });
  if (page.url().includes('/login')) { console.log('NOT AUTHENTICATED, aborting'); await browser.close(); return; }
  console.log('authenticated, proceeding (order #9001 already seeded via draft-order flow)');

  // ---- Real screenshot/interaction pass, both viewports ----
  const sizes = [[1440, 900, 'desktop'], [390, 844, 'mobile']];

  for (const [w, h, tag] of sizes) {
    await page.setViewport({ width: w, height: h });

    // Dashboard
    await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, `dashboard-${tag}.png`);

    // Orders kanban
    await page.goto(`${ADMIN}/orders`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, `orders-kanban-${tag}.png`);
    const card = await page.$('[class*="cursor-pointer"][class*="rounded-xl"]');
    if (card) {
      await card.click();
      await new Promise((r) => setTimeout(r, 1000));
      await shot(page, `orders-detail-modal-${tag}.png`);
      // Close modal (X button) before moving on.
      await page.evaluate(() => {
        const closeBtn = document.querySelector('[aria-label="Close"]') || Array.from(document.querySelectorAll('button')).find((b) => /close/i.test(b.getAttribute('aria-label') || ''));
        if (closeBtn) closeBtn.click();
      });
      await new Promise((r) => setTimeout(r, 600));

      if (tag === 'desktop') {
        // Exercise the "advance status" button directly from the kanban card.
        const advanceClicked = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find((b) => /confirm|accept|prepare|out for delivery|deliver/i.test(b.textContent || ''));
          if (btn) { btn.click(); return btn.textContent.trim(); }
          return null;
        });
        console.log(`[${tag}] advance button clicked:`, advanceClicked);
        await new Promise((r) => setTimeout(r, 1200));
        await shot(page, `orders-kanban-after-advance-${tag}.png`);
      }
    } else {
      console.log(`[${tag}] no order card found on kanban`);
    }

    // Order History
    await page.goto(`${ADMIN}/orders/history`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, `orders-history-${tag}.png`);
    const viewClicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((el) => el.textContent.trim() === 'View');
      if (b) { b.click(); return true; }
      return false;
    });
    if (viewClicked) {
      await new Promise((r) => setTimeout(r, 900));
      await shot(page, `orders-history-detail-modal-${tag}.png`);
    } else {
      console.log(`[${tag}] no View button found in history`);
    }

    // Draft Orders
    await page.goto(`${ADMIN}/orders/draft-orders`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, `orders-draft-${tag}.png`);

    // Abandoned Carts
    await page.goto(`${ADMIN}/orders/abandoned-carts`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, `orders-abandoned-${tag}.png`);

    // Customers
    await page.goto(`${ADMIN}/customers`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, `customers-${tag}.png`);
    const row = await page.$('tbody tr[class*="cursor-pointer"]');
    if (row) {
      await row.click();
      await new Promise((r) => setTimeout(r, 1000));
      await shot(page, `customers-detail-${tag}.png`);
    } else {
      console.log(`[${tag}] no customer row found`);
    }
  }

  await browser.close();
  console.log('DONE');
})();
