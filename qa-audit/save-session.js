const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ADMIN = 'http://localhost:3001';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 3000));
  const tokens = await page.evaluate(() => ({
    access: localStorage.getItem('requital_admin_access_token'),
    refresh: localStorage.getItem('requital_admin_refresh_token'),
  }));
  console.log('tokens:', tokens.access ? 'access OK' : 'MISSING', tokens.refresh ? 'refresh OK' : 'MISSING');
  fs.writeFileSync(path.join(__dirname, 'session.json'), JSON.stringify(tokens));
  await browser.close();
})();
