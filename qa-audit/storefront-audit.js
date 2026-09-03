const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE = 'http://localhost:3002/test-shop';
const SHOTS = 'screenshots';
const findings = [];

function log(...args) {
  console.log(...args);
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function attachListeners(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') log(`[${label}] [console.error]`, m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => log(`[${label}] [pageerror]`, e.message.slice(0, 300)));
  page.on('response', (r) => {
    if (r.status() >= 400) log(`[${label}] [http ${r.status()}]`, r.url());
  });
  page.on('requestfailed', (r) => log(`[${label}] [requestfailed]`, r.url(), r.failure()?.errorText));
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/storefront-${name}.png`, fullPage: true });
  log('screenshot:', name);
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });

  for (const vp of [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
    log(`\n==== VIEWPORT ${vp.tag} (${vp.w}x${vp.h}) ====`);
    const page = await browser.newPage();
    attachListeners(page, vp.tag);
    await page.setViewport({ width: vp.w, height: vp.h });

    // HOME
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 }).catch((e) => log('goto home err', e.message));
    await delay(1500);
    await shot(page, `home-${vp.tag}`);
    const homeText = await page.evaluate(() => document.body.innerText).catch(() => '');
    log('home body text (first 200):', homeText.slice(0, 200).replace(/\n/g, ' | '));

    if (vp.tag === 'desktop') {
      // Only do the full click-through flow once, at desktop, to keep this
      // tractable; mobile pass is a visual/console-error sweep of the same
      // pages via direct navigation (still real, still screenshotted).
      await desktopFlow(page);
    } else {
      await mobileSweep(page);
    }

    await page.close();
  }

  await browser.close();
}

async function desktopFlow(page) {
  // Find a product link on the home page or via collections
  await page.goto(`${BASE}/collections`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1000);
  await shot(page, 'collections-index-desktop');

  // Try clicking first product link found anywhere on home
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1500);

  let productHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href*="/products/"]'))[0];
    return a ? a.getAttribute('href') : null;
  });
  log('first product href found on home:', productHref);

  let collectionHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href*="/collections/"]'))[0];
    return a ? a.getAttribute('href') : null;
  });
  log('first collection href found on home:', collectionHref);

  if (collectionHref) {
    await page.goto(`http://localhost:3002${collectionHref}`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto collection err', e.message));
    await delay(1500);
    await shot(page, 'collection-page-desktop');
    if (!productHref) {
      productHref = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('a[href*="/products/"]'))[0];
        return a ? a.getAttribute('href') : null;
      });
      log('product href found on collection page:', productHref);
    }
  }

  if (productHref) {
    await page.goto(`http://localhost:3002${productHref}`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto product err', e.message));
    await delay(1500);
    await shot(page, 'pdp-desktop');

    // Try selecting a variant option if present
    const variantClicked = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-pressed]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    log('variant option clicked:', variantClicked);
    await delay(500);

    // Add a note if the note field exists
    const noteField = await page.$('input[placeholder*="note" i]');
    if (noteField) {
      await noteField.type('QA audit test note - no card please');
      log('typed item note');
    }

    await shot(page, 'pdp-with-selection-desktop');

    // Click Add to cart
    const addClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /add to cart/i.test(b.textContent || ''));
      if (btn && !btn.disabled) { btn.click(); return true; }
      return btn ? 'disabled' : false;
    });
    log('add to cart clicked:', addClicked);
    await delay(1200);
    await shot(page, 'pdp-after-add-desktop');
  } else {
    log('NO PRODUCT FOUND to click through - catalog likely empty or unpublished');
  }

  // Cart page
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto cart err', e.message));
  await delay(1200);
  await shot(page, 'cart-desktop');

  // Checkout
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto checkout err', e.message));
  await delay(1500);
  await shot(page, 'checkout-initial-desktop');

  // Handle addon prompt if shown (Skip/Continue button)
  const addonSkip = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /skip|continue|no thanks/i.test(b.textContent || ''));
    if (btn) { btn.click(); return btn.textContent; }
    return null;
  });
  log('addon prompt button clicked:', addonSkip);
  await delay(1000);
  await shot(page, 'checkout-form-desktop');

  // Try submitting empty to see validation
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    await delay(800);
    await shot(page, 'checkout-empty-submit-validation-desktop');
  }

  // Fill in the form
  await fillCheckoutForm(page);
  await shot(page, 'checkout-filled-desktop');

  // Try submitting for real
  const submitBtn2 = await page.$('button[type="submit"]');
  if (submitBtn2) {
    const disabled = await page.evaluate((b) => b.disabled, submitBtn2);
    log('submit button disabled?', disabled);
    if (!disabled) {
      await submitBtn2.click();
      await delay(2500);
      log('after submit url:', page.url());
      await shot(page, 'checkout-after-submit-desktop');
    }
  }

  // Order tracking page
  await page.goto(`${BASE}/orders/track`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto track err', e.message));
  await delay(1000);
  await shot(page, 'order-track-desktop');

  // Register account
  const throwawayEmail = `qaaudit${Date.now()}@example.com`;
  const throwawayPhone = `05${Math.floor(10000000 + Math.random() * 89999999)}`;
  await page.goto(`${BASE}/account/register`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto register err', e.message));
  await delay(1000);
  await shot(page, 'account-register-desktop');
  await page.type('input[required]:not([type="tel"]):not([type="email"]):not([type="password"])', 'QA Audit Tester').catch(() => {});
  const inputs = await page.$$('input');
  // Fill by order: Name, Phone, Email, Password (per RegisterPage source)
  if (inputs[0]) await inputs[0].type('QA Audit Tester');
  if (inputs[1]) await inputs[1].type(throwawayPhone);
  if (inputs[2]) await inputs[2].type(throwawayEmail);
  if (inputs[3]) await inputs[3].type('TestPassword123!');
  await shot(page, 'account-register-filled-desktop');
  const registerBtn = await page.$('button[type="submit"]');
  if (registerBtn) {
    await registerBtn.click();
    await delay(2000);
  }
  log('after register url:', page.url());
  await shot(page, 'account-after-register-desktop');

  // Account dashboard
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto account err', e.message));
  await delay(1000);
  await shot(page, 'account-dashboard-desktop');

  // Order history
  await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto order history err', e.message));
  await delay(1000);
  await shot(page, 'account-order-history-desktop');

  // Addresses
  await page.goto(`${BASE}/account/addresses`, { waitUntil: 'networkidle2', timeout: 20000 }).catch((e) => log('goto addresses err', e.message));
  await delay(1000);
  await shot(page, 'account-addresses-desktop');
  // Try starting a new address form
  const addAddrClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /add address/i.test(b.textContent || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  log('add address clicked:', addAddrClicked);
  await delay(800);
  await shot(page, 'account-address-form-desktop');
}

async function fillCheckoutForm(page) {
  // Name/Phone/Email are the first 3 free-text inputs typically
  const nameInput = await page.$('input[required]:not([type="tel"]):not([type="email"]):not([type="checkbox"]):not([type="radio"])');
  if (nameInput) await nameInput.type('QA Audit Customer');
  const phoneInput = await page.$('input[type="tel"]');
  if (phoneInput) await phoneInput.type('0501234567');
  const emailInput = await page.$('input[type="email"]');
  if (emailInput) await emailInput.type('qa-checkout@example.com');
  const addressTextarea = await page.$('textarea[required]');
  if (addressTextarea) await addressTextarea.type('123 Test Street, Downtown');
  // pick first radio (payment method) if not already selected
  await page.evaluate(() => {
    const radio = document.querySelector('input[type="radio"]');
    if (radio && !radio.checked) radio.click();
  });
}

async function mobileSweep(page) {
  const pages = [
    '/collections',
    '', // will be re-navigated with product/collection hrefs found live
  ];
  // Discover a collection + product link fresh on mobile
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1200);
  const collectionHref = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a[href*="/collections/"]'))[0];
    return a ? a.getAttribute('href') : null;
  });
  if (collectionHref) {
    await page.goto(`http://localhost:3002${collectionHref}`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    await delay(1200);
    await shot(page, 'collection-page-mobile');
    const productHref = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a[href*="/products/"]'))[0];
      return a ? a.getAttribute('href') : null;
    });
    if (productHref) {
      await page.goto(`http://localhost:3002${productHref}`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
      await delay(1200);
      await shot(page, 'pdp-mobile');
    }
  }

  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1000);
  await shot(page, 'cart-mobile');

  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1200);
  await shot(page, 'checkout-mobile');

  await page.goto(`${BASE}/account/login`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1000);
  await shot(page, 'account-login-mobile');

  await page.goto(`${BASE}/orders/track`, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(1000);
  await shot(page, 'order-track-mobile');
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
