// Log in exactly once into a persistent Chrome profile so every later script
// (which launches with the same userDataDir) is already authenticated —
// avoids re-tripping the shared 5-req/60s login throttle on every run.
const puppeteer = require('puppeteer');
const path = require('path');
const PROFILE = path.join(__dirname, 'chrome-profile');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', userDataDir: PROFILE });
  const page = await browser.newPage();
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
  const emailInput = await page.$('input[type="email"]');
  if (!emailInput) {
    console.log('already authenticated');
    await browser.close();
    return;
  }
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 2500));
  console.log('final url:', page.url());
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log('body:', bodyText);
  await browser.close();
})();
