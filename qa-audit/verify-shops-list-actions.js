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
  // This dev DB has ~26k leftover shops from prior e2e runs — filter down
  // to the one shop this test cares about before touching the DOM (the
  // list has no pagination yet, and evaluating over every row blows the
  // page's call stack; a real deployment won't have this many shops, but
  // worth flagging as a future pagination need regardless).
  await page.type('input[placeholder="Search name or subdomain..."]', 'test-shop');
  await new Promise((r) => setTimeout(r, 600));
  await page.waitForSelector(`a[href="/platform/shops/${SHOP_ID}"]`, { timeout: 15000 });

  const actionButtons = await page.$$eval(
    `tr td:last-child button, tr td:last-child a`,
    (els) => els.map((el) => el.getAttribute('aria-label')),
  );
  log('1. List row has 3 labeled actions per shop (view/impersonate/suspend)', actionButtons.length >= 3, JSON.stringify(actionButtons.slice(0, 6)));

  // Click the suspend icon button for shop 1's row specifically.
  const suspendBtn = await page.$(`button[aria-label*="Suspend Test Flower Shop"]`);
  log('2. Found the Suspend icon button by aria-label', !!suspendBtn);
  if (suspendBtn) {
    await suspendBtn.click();
    await new Promise((r) => setTimeout(r, 800));
  }
  const statusAfter = await page.$eval(
    `a[href="/platform/shops/${SHOP_ID}"]`,
    (el) => el.closest('tr').querySelector('td:nth-child(2)').textContent,
  );
  log('3. Status column shows Suspended after clicking the icon', statusAfter.trim() === 'Suspended', statusAfter);

  const unsuspendBtn = await page.$(`button[aria-label*="Unsuspend Test Flower Shop"]`);
  log('4. Icon swapped to Unsuspend after suspending', !!unsuspendBtn);
  if (unsuspendBtn) {
    await unsuspendBtn.click();
    await new Promise((r) => setTimeout(r, 800));
  }
  const statusAfter2 = await page.$eval(
    `a[href="/platform/shops/${SHOP_ID}"]`,
    (el) => el.closest('tr').querySelector('td:nth-child(2)').textContent,
  );
  log('5. Status column back to Active after unsuspending via icon', statusAfter2.trim() === 'Active', statusAfter2);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
