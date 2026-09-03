// Verifies impersonation-expiry handling without waiting a real hour: mints
// a real impersonation session, then corrupts the stored access token so
// the next API call 401s exactly the way a genuinely expired token would,
// and checks RequireAuth routes to /impersonation-ended instead of /login.
// Run from qa-audit/: node verify-impersonation-expiry.js
const puppeteer = require('puppeteer');

const ADMIN = 'http://localhost:3001';
const PLATFORM_EMAIL = 'puppeteer-test@example.com';
const PLATFORM_PASSWORD = 'TestPass123XYZ';
const SHOP_ID = 1;

function log(step, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${step}${detail ? `: ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('dialog', async (d) => { await d.accept(); });

  await page.goto(`${ADMIN}/platform/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.type('input[type="email"]', PLATFORM_EMAIL);
  await page.type('input[type="password"]', PLATFORM_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`${ADMIN}/platform/shops/${SHOP_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });

  const buttons = await page.$$('button');
  let btn = null;
  for (const b of buttons) {
    const text = await page.evaluate((el) => el.textContent, b);
    if (text.trim() === 'Log in as this shop') { btn = b; break; }
  }
  log('1. Found impersonate button', !!btn);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
    btn.click(),
  ]);
  await new Promise((r) => setTimeout(r, 500));
  log('2. Impersonation started', page.url() === `${ADMIN}/`, page.url());

  // Simulate expiry: corrupt the merchant access token so the next API call
  // 401s, exactly what a real expired 1h token produces.
  await page.evaluate(() => {
    localStorage.setItem('requital_admin_access_token', 'expired.fake.token');
  });
  await page.goto(`${ADMIN}/orders`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 2000));

  log(
    '3. Expired impersonation session redirects to /impersonation-ended (not /login)',
    page.url().includes('/impersonation-ended'),
    page.url(),
  );
  const bodyText = await page.evaluate(() => document.body.textContent);
  log('4. Expiry page shows a clear message', bodyText.includes('Impersonation session expired'));
  log('5. Expiry page carries shopId back to the right shop', page.url().includes(`shopId=${SHOP_ID}`), page.url());

  // The "Return to platform admin" link should land back in a live platform
  // session (the platform token was never touched).
  const links = await page.$$('a');
  let returnLink = null;
  for (const a of links) {
    const text = await page.evaluate((el) => el.textContent, a);
    if (text.trim() === 'Return to platform admin') { returnLink = a; break; }
  }
  log('6. Found "Return to platform admin" link', !!returnLink);
  if (returnLink) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
      returnLink.click(),
    ]);
    await new Promise((r) => setTimeout(r, 500));
    log(
      '7. Return link lands back on the shop detail page, no re-login needed',
      page.url() === `${ADMIN}/platform/shops/${SHOP_ID}`,
      page.url(),
    );
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
