// Seed real order+customer data via the admin Draft Order flow (no storefront
// publish/email-verification needed) so kanban/history/customer-detail have
// something real to click into.
const puppeteer = require('puppeteer');
const ADMIN = 'http://localhost:3001';

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function fillByLabel(page, labelText, value) {
  await page.evaluate((labelText, value, setNativeValueStr) => {
    const setNativeValue = eval(`(${setNativeValueStr})`);
    const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent.trim().startsWith(labelText));
    if (!label) throw new Error('label not found: ' + labelText);
    const input = document.getElementById(label.htmlFor);
    if (!input) throw new Error('input not found for label: ' + labelText);
    setNativeValue(input, value);
  }, labelText, value, setNativeValue.toString());
}

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

  await page.goto(`${ADMIN}/orders/draft-orders/new`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: 'screenshots/_seed-draft-new.png', fullPage: true });

  await fillByLabel(page, 'Name', 'Fatima Al Mansoori');
  await fillByLabel(page, 'Phone', '+971501234567');
  await fillByLabel(page, 'Address', 'Villa 12, Al Wasl Road');

  // Open the product Combobox (first combobox button on the page after customer fields).
  const comboButtons = await page.$$('button[role="combobox"]');
  console.log('combobox count:', comboButtons.length);
  // Log their current text to identify which is "Select a product..."
  for (const btn of comboButtons) {
    const txt = await page.evaluate((el) => el.textContent, btn);
    console.log('  combobox:', txt);
  }

  const productComboIdx = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[role="combobox"]'));
    return btns.findIndex((b) => /select a product/i.test(b.textContent || ''));
  });
  console.log('product combo idx:', productComboIdx);

  if (productComboIdx >= 0) {
    await comboButtons[productComboIdx].click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: 'screenshots/_seed-draft-product-open.png', fullPage: true });
    const firstOption = await page.$('button[role="option"]');
    if (firstOption) {
      const optText = await page.evaluate((el) => el.textContent, firstOption);
      console.log('selecting product option:', optText);
      await firstOption.click();
    } else {
      console.log('NO PRODUCT OPTIONS AVAILABLE — catalog may be empty');
    }
  }
  await new Promise((r) => setTimeout(r, 500));

  // Click "Add" (the item-add button, distinct from "Add to cart" etc.).
  const addClicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[type="button"]')).find((b) => b.textContent.trim() === 'Add');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
  console.log('add item clicked:', addClicked);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: 'screenshots/_seed-draft-filled.png', fullPage: true });

  // Submit the form.
  const submitted = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[type="submit"]')).find((b) => /create draft/i.test(b.textContent || '') || /create/i.test(b.textContent || ''));
    if (btn) { btn.click(); return btn.textContent; }
    return null;
  });
  console.log('submit clicked:', submitted);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshots/_seed-draft-after-submit.png', fullPage: true });
  console.log('final URL:', page.url());
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('BODY:', bodyText);

  await browser.close();
})();
