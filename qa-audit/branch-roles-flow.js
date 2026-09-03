const puppeteer = require('puppeteer');
const path = require('path');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';

async function login(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`); });
  page.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`); });

  await page.setViewport({ width: 1440, height: 900 });
  await login(page);
  await page.goto(`${ADMIN}/settings/users`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // Create a branch role
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find((b) => /new branch role/i.test(b.textContent))?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input', 'Branch Viewer Test');
  await page.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    cbs[0]?.click(); // View orders
    cbs[2]?.click(); // View dashboard
  });
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    btns.find((b) => /create branch role/i.test(b.textContent))?.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'settings-users-after-role-create.png'), fullPage: true });

  // Create a branch account (role=branch)
  const newAccBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /new branch account/i.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  });
  console.log('New branch account clicked:', newAccBtn);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOT_DIR, 'settings-users-new-account-modal-filled.png'), fullPage: true });
  // dump form fields present
  const fields = await page.evaluate(() => {
    return {
      inputs: Array.from(document.querySelectorAll('.fixed input, [class*="modal"] input, input')).map(i => ({name: i.name, type: i.type, placeholder: i.placeholder})).slice(0, 15),
      selects: Array.from(document.querySelectorAll('select')).map(s => ({name: s.name, options: Array.from(s.options).map(o=>o.value)})),
    };
  });
  console.log('Form fields:', JSON.stringify(fields, null, 2));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.trim() === 'Cancel');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // Now try New assignment
  const assignBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /new assignment/i.test(x.textContent));
    if (b && !b.disabled) { b.click(); return true; }
    return b ? 'disabled' : false;
  });
  console.log('New assignment clicked:', assignBtn);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOT_DIR, 'settings-users-assign-modal.png'), fullPage: true });

  await browser.close();
})();
