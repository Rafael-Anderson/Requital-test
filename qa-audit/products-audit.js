const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[CONSOLE ERROR][${label}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.log(`[PAGE ERROR][${label}] ${err.message}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[HTTP ${res.status()}][${label}] ${res.request().method()} ${res.url()}`);
    }
  });
}

async function login(page) {
  attachListeners(page, 'login');
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('button[type="submit"]'),
  ]);
  console.log('Logged in, url:', page.url());
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
  console.log('screenshot:', name);
}

// tiny 1x1 png for upload testing
const PNG_PATH = path.join(__dirname, 'test-image.png');
if (!fs.existsSync(PNG_PATH)) {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  fs.writeFileSync(PNG_PATH, Buffer.from(b64, 'base64'));
}

async function clickByText(page, tag, text) {
  const handle = await page.evaluateHandle(
    (tag, text) => {
      const els = Array.from(document.querySelectorAll(tag));
      return els.find((el) => el.textContent && el.textContent.includes(text)) || null;
    },
    tag,
    text,
  );
  const el = handle.asElement();
  if (el) {
    await el.click();
    return true;
  }
  return false;
}

async function findByXpathLikeLabel(page, labelText) {
  // components/ui/Input.tsx renders a real htmlFor/id pair - use that.
  const handle = await page.evaluateHandle((labelText) => {
    const labels = Array.from(document.querySelectorAll('label'));
    const label = labels.find((l) => l.textContent && l.textContent.trim() === labelText);
    if (!label) return null;
    const forId = label.getAttribute('for');
    return forId ? document.getElementById(forId) : null;
  }, labelText);
  return handle.asElement();
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await login(page);

  // ============ PRODUCT LIST ============
  attachListeners(page, 'product-list');
  await page.goto(`${ADMIN}/products`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(page, 'products-list-desktop.png');

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${ADMIN}/products`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(page, 'products-list-mobile.png');
  await page.setViewport({ width: 1440, height: 900 });

  // ============ PRODUCT CREATE WIZARD ============
  attachListeners(page, 'product-new');
  await page.goto(`${ADMIN}/products/new`, { waitUntil: 'networkidle2' });
  await sleep(800);
  await shot(page, 'products-wizard-step1-desktop.png');

  await page.type('input', 'QA Audit Test Rose Bouquet');
  await sleep(200);

  // Try clicking Next WITHOUT an image to see step1->step2 gating behavior
  const advanced1 = await clickByText(page, 'button', 'Next');
  await sleep(600);
  await shot(page, 'products-wizard-after-next-noimage.png');
  console.log('URL after Next (no image):', page.url());

  // Go back to step 1 to add an image before continuing
  await clickByText(page, 'button', 'Back');
  await sleep(500);

  // Upload image via ImageDropzone's file input
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.uploadFile(PNG_PATH);
    await sleep(1500);
    await shot(page, 'products-wizard-step1-image-uploaded.png');
  } else {
    console.log('NO FILE INPUT FOUND on step 1');
  }

  await clickByText(page, 'button', 'Next');
  await sleep(600);
  await shot(page, 'products-wizard-step2-pricing.png');
  console.log('URL at step2:', page.url());

  // Fill price + SKU
  const priceInput = await findByXpathLikeLabel(page, 'Price (AED)');
  if (priceInput) await priceInput.type('99.00');
  else console.log('PRICE INPUT NOT FOUND');
  const skuInput = await findByXpathLikeLabel(page, 'SKU');
  if (skuInput) await skuInput.type('QA-TEST-001');
  else console.log('SKU INPUT NOT FOUND');
  await sleep(300);
  await shot(page, 'products-wizard-step2-filled.png');

  await clickByText(page, 'button', 'Next');
  await sleep(600);
  await shot(page, 'products-wizard-step3-organization.png');
  console.log('URL at step3:', page.url());

  // Try submit WITHOUT selecting a collection - should error and jump back
  await clickByText(page, 'button', 'Create product');
  await sleep(800);
  await shot(page, 'products-wizard-submit-no-collection.png');
  console.log('URL after submit w/o collection:', page.url());

  // Go forward to step3 again (if it jumped back) and select first collection checkbox
  await clickByText(page, 'button', 'Next');
  await sleep(500);
  await clickByText(page, 'button', 'Next');
  await sleep(500);
  const collectionCheckbox = await page.$('input[type="checkbox"]');
  if (collectionCheckbox) {
    await collectionCheckbox.click();
    await sleep(200);
  } else {
    console.log('NO COLLECTION CHECKBOX FOUND on step 3 - cannot satisfy validation');
  }

  // Expand Variants / Attributes / FAQs accordions (they should be present as "+Add X" links since disabled by default in simple mode... actually simple mode enabling opens them)
  await shot(page, 'products-wizard-step3-before-features.png');

  const addVariantsLink = await clickByText(page, 'button', 'Add variants');
  console.log('Clicked Add variants:', addVariantsLink);
  await sleep(400);
  await shot(page, 'products-wizard-variants-expanded-newproduct.png');

  const addAttrLink = await clickByText(page, 'button', 'Add attributes');
  console.log('Clicked Add attributes:', addAttrLink);
  await sleep(400);

  const addFaqLink = await clickByText(page, 'button', 'Add FAQs');
  console.log('Clicked Add FAQs:', addFaqLink);
  await sleep(400);
  await shot(page, 'products-wizard-step3-features-expanded.png');

  // Fill an attribute row
  const attrNameInput = await page.$('input[aria-label="Attribute name"]');
  const attrValueInput = await page.$('input[aria-label="Attribute value"]');
  if (attrNameInput && attrValueInput) {
    await attrNameInput.type('Material');
    await attrValueInput.type('Cotton');
  } else {
    console.log('ATTRIBUTE ROW INPUTS NOT FOUND');
  }
  // Fill an FAQ row
  const faqQ = await page.$('input[aria-label="Question"]');
  const faqA = await page.$('textarea[aria-label="Answer"]');
  if (faqQ && faqA) {
    await faqQ.type('Does this ship internationally?');
    await faqA.type('No, UAE only for now.');
  } else {
    console.log('FAQ ROW INPUTS NOT FOUND');
  }
  await sleep(300);
  await shot(page, 'products-wizard-attrs-faqs-filled.png');

  // Now finally submit
  await clickByText(page, 'button', 'Create product');
  await sleep(1500);
  await shot(page, 'products-wizard-after-final-submit.png');
  console.log('URL after final submit:', page.url());

  await browser.close();
})();
