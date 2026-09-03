const puppeteer = require('puppeteer');
const path = require('path');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${label}] CONSOLE ERROR:`, msg.text());
  });
  page.on('pageerror', (err) => {
    console.log(`[${label}] PAGE ERROR:`, err.message);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[${label}] HTTP ${res.status()}:`, res.url());
    }
  });
}

async function login(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  const emailInput = await page.$('input[type="email"]');
  if (!emailInput) return; // already authenticated (redirected away from /login)
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]'),
  ]);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
  console.log('  screenshot:', name);
}

async function visitBothSizes(browser, urlPath, prefix, actions) {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const page = await browser.newPage();
    attachListeners(page, `${prefix}-${tag}`);
    await page.setViewport({ width: w, height: h });
    await login(page);
    console.log(`\n=== ${prefix} @ ${tag} (${w}x${h}) : ${urlPath} ===`);
    await page.goto(`${ADMIN}${urlPath}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));
    await shot(page, `${prefix}-${tag}.png`);
    if (actions) {
      try {
        await actions(page, tag);
      } catch (e) {
        console.log(`  action error (${tag}):`, e.message);
      }
    }
    await page.close();
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });

  await visitBothSizes(browser, '/dashboard', 'dashboard');

  await visitBothSizes(browser, '/orders', 'orders-kanban', async (page, tag) => {
    // try clicking first order card if present
    const card = await page.$('[class*="cursor-pointer"][class*="rounded-xl"]');
    if (card) {
      await card.click();
      await new Promise((r) => setTimeout(r, 1000));
      await shot(page, `orders-detail-modal-${tag}.png`);
      // try closing
    } else {
      console.log('  no order card found to click');
    }
  });

  await visitBothSizes(browser, '/orders/history', 'orders-history', async (page, tag) => {
    const viewBtn = await page.$$eval('button', (btns) => {
      const b = btns.find((el) => el.textContent.trim() === 'View');
      if (b) { b.click(); return true; }
      return false;
    }).catch(() => false);
    if (viewBtn) {
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, `orders-history-detail-modal-${tag}.png`);
    }
  });

  await visitBothSizes(browser, '/orders/draft-orders', 'orders-draft');

  await visitBothSizes(browser, '/orders/abandoned-carts', 'orders-abandoned');

  await visitBothSizes(browser, '/customers', 'customers', async (page, tag) => {
    const row = await page.$('tbody tr.cursor-pointer, tbody tr[class*="cursor-pointer"]');
    if (row) {
      await row.click();
      await new Promise((r) => setTimeout(r, 1000));
      await shot(page, `customers-detail-${tag}.png`);
    } else {
      console.log('  no customer row found to click');
    }
  });

  await browser.close();
  console.log('\nDONE');
})();
