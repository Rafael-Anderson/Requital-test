const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const session = JSON.parse(fs.readFileSync(path.join(__dirname, 'session.json'), 'utf8'));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text().slice(0, 200)); });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem('requital_admin_access_token', s.access);
    localStorage.setItem('requital_admin_refresh_token', s.refresh);
  }, session);
  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: path.join(SHOT_DIR, 'theme-builder-mobile-390.png') });
  console.log('screenshot saved');

  // also check /theme library page on mobile
  await page.goto(`${ADMIN}/theme`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(SHOT_DIR, 'theme-library-mobile-390.png') });
  console.log('library screenshot saved');

  await browser.close();
})();
