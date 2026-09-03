// Discover shop slug, then place a real storefront order + start (and abandon)
// a second checkout, so the admin Orders/Customers pages have real data to click into.
const puppeteer = require('puppeteer');
const ADMIN = 'http://localhost:3001';
const STOREFRONT = 'http://localhost:3002';

async function login(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  const emailInput = await page.$('input[type="email"]');
  if (!emailInput) return;
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]'),
  ]);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  await login(page);

  const shopInfo = await page.evaluate(async () => {
    const token = localStorage.getItem('requital_admin_access_token') || localStorage.getItem('accessToken');
    // Try common key names; fall back to scanning localStorage for a JWT-looking value.
    let tok = token;
    if (!tok) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        if (v && v.split('.').length === 3) { tok = v; break; }
      }
    }
    const res = await fetch('http://localhost:3000/shop', { headers: { Authorization: `Bearer ${tok}` } });
    return { status: res.status, body: await res.json(), usedKey: tok ? 'found' : 'none' };
  });
  console.log('shop info:', JSON.stringify(shopInfo));

  const slug = shopInfo.body?.subdomain;
  if (!slug) {
    console.log('Could not resolve shop slug, aborting seed.');
    await browser.close();
    return;
  }

  // Storefront: browse to home, find a product, add to cart, checkout.
  await page.goto(`${STOREFRONT}/${slug}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'C:/Requital/Requital-test/qa-audit/screenshots/_seed-storefront-home.png', fullPage: true });

  const productHref = await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a')).find((a) => /\/products\//.test(a.getAttribute('href') || ''));
    return link ? link.getAttribute('href') : null;
  });
  console.log('product href:', productHref);
  if (!productHref) {
    console.log('No product link found on homepage; cannot seed an order.');
    await browser.close();
    return;
  }

  await page.goto(`${STOREFRONT}${productHref}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  // Click "Add to cart" (best-effort text match).
  const added = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /add to cart/i.test(b.textContent || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('add to cart clicked:', added);
  await new Promise((r) => setTimeout(r, 1000));

  await page.goto(`${STOREFRONT}/${slug}/checkout`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'C:/Requital/Requital-test/qa-audit/screenshots/_seed-checkout-start.png', fullPage: true });

  // Dump all visible input/select/textarea name/placeholder/label info to fill generically.
  const fields = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input,select,textarea')).map((el) => ({
      tag: el.tagName, type: el.type, name: el.name, id: el.id, placeholder: el.placeholder,
    }));
  });
  console.log('checkout fields:', JSON.stringify(fields));

  await browser.close();
})();
