const puppeteer = require('puppeteer');
const path = require('path');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${label}] CONSOLE ERROR:`, msg.text());
  });
  page.on('pageerror', (err) => {
    console.log(`[${label}] PAGE ERROR:`, err.message);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[${label}] HTTP ${res.status()}:`, res.url());
    }
  });
  page.on('requestfailed', (req) => {
    console.log(`[${label}] REQUEST FAILED:`, req.url(), req.failure()?.errorText);
  });
}

async function login(page) {
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  const emailInput = await page.$('input[type="email"]');
  if (!emailInput) return;
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 3000));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
  console.log('  screenshot:', name);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  attachListeners(page, 'theme');
  await page.setViewport({ width: 1440, height: 900 });
  await login(page);

  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2000));
  console.log('URL:', page.url());

  // Inspect the iframe element directly.
  const iframeInfo = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return { found: false };
    return { found: true, src: f.src, w: f.offsetWidth, h: f.offsetHeight };
  });
  console.log('iframe info:', iframeInfo);

  // Try fetching the iframe src directly to see what it returns.
  if (iframeInfo.found && iframeInfo.src) {
    try {
      const resp = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url);
          return { status: r.status, text: (await r.text()).slice(0, 500) };
        } catch (e) {
          return { error: String(e) };
        }
      }, iframeInfo.src);
      console.log('direct fetch of iframe src:', JSON.stringify(resp).slice(0, 800));
    } catch (e) {
      console.log('fetch eval failed:', e.message);
    }
  }

  await new Promise((r) => setTimeout(r, 2000));
  await shot(page, 'theme-iframe-debug.png');

  // ---- Theme Settings mode via aria-label ----
  console.log('\n=== Theme Settings mode ===');
  const themeSettingsBtn = await page.$('button[aria-label="Theme settings"]');
  console.log('  theme settings btn found:', !!themeSettingsBtn);
  if (themeSettingsBtn) await themeSettingsBtn.click();
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, 'theme-settings-mode-list-v2.png');

  const categoryLabels = [
    'Logo and favicon', 'Colors', 'Typography', 'Page layout', 'Animations', 'Badges',
    'Buttons', 'Cart', 'Drawers', 'Icons', 'Input fields', 'Popovers and modals', 'Prices',
    'Product cards', 'Search', 'Swatches', 'Variant pickers', 'Custom CSS', 'Collection page',
  ];
  for (const cat of categoryLabels) {
    const clicked = await page.evaluate((catName) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((el) => (el.textContent || '').trim() === catName);
      if (b) { b.click(); return true; }
      return false;
    }, cat);
    if (!clicked) { console.log(`  category NOT FOUND: ${cat}`); continue; }
    await new Promise((r) => setTimeout(r, 400));
    const safe = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await shot(page, `theme-settings-cat-${safe}.png`);
  }

  // Custom CSS interaction
  console.log('\n=== Custom CSS interaction ===');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => (el.textContent || '').trim() === 'Custom CSS');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const textarea = await page.$('textarea');
  console.log('  textarea found:', !!textarea);
  if (textarea) {
    await textarea.click();
    await page.keyboard.type('.audit-marker{color:red}');
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, 'theme-custom-css-typed-v2.png');
  }

  // ---- Layout mode via aria-label ----
  console.log('\n=== Layout mode ===');
  const layoutBtn = await page.$('button[aria-label="Layout"]');
  console.log('  layout btn found:', !!layoutBtn);
  if (layoutBtn) await layoutBtn.click();
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, 'theme-layout-mode-list-v2.png');

  const layoutLabels = [
    'Home tab', 'Menu', 'Homepage layout', 'Top bar layout', 'Header size', 'Footer layout',
    'Footer size', 'Product page layout', 'Cart layout', 'Checkout layout', 'Icon style',
    'Button shape', 'Button fill',
  ];
  for (const cat of layoutLabels) {
    const clicked = await page.evaluate((catName) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((el) => (el.textContent || '').trim() === catName);
      if (b) { b.click(); return true; }
      return false;
    }, cat);
    if (!clicked) { console.log(`  layout category NOT FOUND: ${cat}`); continue; }
    await new Promise((r) => setTimeout(r, 400));
    const safe = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await shot(page, `theme-layout-cat-${safe}.png`);
  }

  await browser.close();
  console.log('\n=== PHASE 2 DONE ===');
})();
