// Verifies the platform-admin UI fixes end-to-end against local dev servers
// (backend :3000, admin :3001). Run from qa-audit/ so its own puppeteer
// install resolves: node verify-platform-admin-ui.js
const puppeteer = require('puppeteer');

const ADMIN = 'http://localhost:3001';
const API = 'http://localhost:3000';
const PLATFORM_EMAIL = 'puppeteer-test@example.com';
const PLATFORM_PASSWORD = 'TestPass123XYZ';
const SHOP_ID = 1;
const SHOP_SUBDOMAIN = 'test-shop';
const MERCHANT_EMAIL = 'admin@test-shop.com';
const MERCHANT_PASSWORD = 'dev-password-123';

function log(step, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${step}${detail ? `: ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('dialog', async (dialog) => {
    console.log(`  [dialog] ${dialog.type()}: ${dialog.message().replace(/\n/g, ' ')}`);
    await dialog.accept();
  });

  // 1. Log into /platform
  await page.goto(`${ADMIN}/platform/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.type('input[type="email"]', PLATFORM_EMAIL);
  await page.type('input[type="password"]', PLATFORM_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('button[type="submit"]'),
  ]);
  log('1. Platform login', page.url().includes('/platform/shops'), page.url());

  // Go straight to the known test shop's detail page.
  await page.goto(`${ADMIN}/platform/shops/${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  const nameOnPage = await page.$eval('h1', (el) => el.textContent);
  log('1b. Shop detail page loads', !!nameOnPage, nameOnPage);

  // 2. Suspend the shop via the detail-page button; confirm() is auto-accepted above.
  const buttons = await page.$$('button');
  let clicked = false;
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.trim() === 'Suspend shop') {
      await b.click();
      clicked = true;
      break;
    }
  }
  log('2a. Clicked Suspend shop button', clicked);
  await page.waitForFunction(
    () => document.body.textContent.includes('This shop is suspended.'),
    { timeout: 5000 },
  ).catch(() => {});
  const bannerVisible = await page.evaluate(() =>
    document.body.textContent.includes('This shop is suspended.'),
  );
  log('2b. Suspended banner visible on detail page', bannerVisible);

  // Confirm merchant login is actually blocked now.
  const loginRes = await page.evaluate(async (api, email, password) => {
    const res = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.status;
  }, API, MERCHANT_EMAIL, MERCHANT_PASSWORD);
  log('2c. Merchant login blocked while suspended (expect 403)', loginRes === 403, `got ${loginRes}`);

  // Confirm storefront is offline.
  const publicRes = await page.evaluate(async (api, slug) => {
    const res = await fetch(`${api}/public/${slug}`);
    return res.status;
  }, API, SHOP_SUBDOMAIN);
  log('2d. Storefront offline while suspended (expect 404)', publicRes === 404, `got ${publicRes}`);

  // 3. Unsuspend.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  const buttons2 = await page.$$('button');
  let clicked2 = false;
  for (const b of buttons2) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.trim() === 'Unsuspend shop') {
      await b.click();
      clicked2 = true;
      break;
    }
  }
  log('3a. Clicked Unsuspend shop button', clicked2);
  await new Promise((r) => setTimeout(r, 800));

  const loginRes2 = await page.evaluate(async (api, email, password) => {
    const res = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.status;
  }, API, MERCHANT_EMAIL, MERCHANT_PASSWORD);
  log('3b. Merchant login works again after unsuspend (expect 201)', loginRes2 === 201, `got ${loginRes2}`);

  const publicRes2 = await page.evaluate(async (api, slug) => {
    const res = await fetch(`${api}/public/${slug}`);
    return res.status;
  }, API, SHOP_SUBDOMAIN);
  log('3c. Storefront back online after unsuspend (expect 200)', publicRes2 === 200, `got ${publicRes2}`);

  // 4. Impersonate.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  const buttons3 = await page.$$('button');
  let impersonateBtn = null;
  for (const b of buttons3) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.trim() === 'Log in as this shop') {
      impersonateBtn = b;
      break;
    }
  }
  log('4a. Found "Log in as this shop" button', !!impersonateBtn);
  if (impersonateBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
      impersonateBtn.click(),
    ]);
  }
  await new Promise((r) => setTimeout(r, 500));
  log('4b. Same-tab navigation landed on merchant admin root', page.url() === `${ADMIN}/`, page.url());

  const bannerText = await page.evaluate(() => document.body.textContent).catch(() => '');
  log(
    '4c. Impersonation banner visible with shop name',
    bannerText.includes('Viewing as') && bannerText.includes('Test Flower Shop'),
  );

  // Merchant admin actually works while impersonating (hit a real page).
  await page.goto(`${ADMIN}/orders`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1500));
  const ordersLoaded = await page.evaluate(() => document.body.textContent.length > 100);
  log('4d. Merchant admin (Orders page) renders while impersonating', ordersLoaded);
  const bannerStillThere = await page.evaluate(() =>
    document.body.textContent.includes('Exit impersonation'),
  );
  log('4e. Banner persists across merchant admin navigation', bannerStillThere);

  // Exit impersonation.
  const exitButtons = await page.$$('button');
  let exited = false;
  for (const b of exitButtons) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.trim() === 'Exit impersonation') {
      await b.click();
      exited = true;
      break;
    }
  }
  log('4f. Clicked Exit impersonation', exited);
  await new Promise((r) => setTimeout(r, 800));
  log(
    '4g. Exit returned to the shop detail page in /platform',
    page.url() === `${ADMIN}/platform/shops/${SHOP_ID}`,
    page.url(),
  );

  // 5. Audit log recorded impersonation and both suspend actions.
  const platformTokenRes = await page.evaluate(async (api, email, password) => {
    const res = await fetch(`${api}/platform-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }, API, PLATFORM_EMAIL, PLATFORM_PASSWORD);
  const auditLog = await page.evaluate(
    async (api, token, shopId) => {
      const res = await fetch(`${api}/platform-admin/audit-log?shopId=${shopId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    },
    API,
    platformTokenRes.accessToken,
    SHOP_ID,
  );
  const actions = auditLog.map((e) => e.action);
  log(
    '5. Audit log has shop.suspend, shop.unsuspend, shop.impersonate',
    actions.includes('shop.suspend') && actions.includes('shop.unsuspend') && actions.includes('shop.impersonate'),
    JSON.stringify(actions.slice(0, 5)),
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

verifyExpiry().catch((err) => { console.error(err); process.exit(1); });
