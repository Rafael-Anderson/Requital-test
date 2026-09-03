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

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
  console.log('  screenshot:', name);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--window-size=1440,900'] });
  const page = await browser.newPage();
  attachListeners(page, 'theme');
  await page.setViewport({ width: 1440, height: 900 });
  await login(page);

  console.log('\n=== Navigate to /theme (library) ===');
  await page.goto(`${ADMIN}/theme`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await shot(page, 'theme-library-desktop.png');

  // Click "Edit theme" / go straight to the builder for the first theme.
  console.log('\n=== Enter builder ===');
  const editBtn = await page.$$eval('button, a', (els) => {
    const b = els.find((el) => /edit theme/i.test(el.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (!editBtn) {
    console.log('  no "Edit theme" button found, trying "Add theme" / direct nav');
  }
  await page.waitForFunction(() => window.location.pathname.includes('/builder'), { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  console.log('  URL:', page.url());
  await shot(page, 'theme-builder-initial-desktop.png');

  const themeIdMatch = page.url().match(/\/theme\/(\d+)\/builder/);
  const themeId = themeIdMatch ? themeIdMatch[1] : null;
  console.log('  themeId:', themeId);

  // ---- Sections builder overview ----
  console.log('\n=== Sections mode overview ===');
  await shot(page, 'theme-sections-overview.png');

  // Expand a section in the tree to see block-level settings, click Hero section.
  const heroRow = await page.$$eval('button', (btns) => {
    const b = btns.find((el) => /hero/i.test(el.textContent || ''));
    return b ? true : false;
  });
  console.log('  hero row present:', heroRow);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => /^hero$/i.test((el.textContent || '').trim()));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, 'theme-sections-hero-selected.png');

  // ---- Global Settings (Theme Settings) categories ----
  console.log('\n=== Theme Settings mode: iterate categories ===');
  // Click "Theme settings" mode switcher tab.
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => /theme settings/i.test((el.textContent || '').trim()));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, 'theme-settings-mode-list.png');

  const categories = await page.$$eval('button', (btns) =>
    btns
      .map((b) => (b.textContent || '').trim())
      .filter((t) =>
        [
          'Logo and favicon', 'Colors', 'Typography', 'Page layout', 'Animations', 'Badges',
          'Buttons', 'Cart', 'Drawers', 'Icons', 'Input fields', 'Popovers and modals', 'Prices',
          'Product cards', 'Search', 'Swatches', 'Variant pickers', 'Custom CSS', 'Collection page',
        ].includes(t),
      ),
  );
  console.log('  found categories:', categories);

  for (const cat of categories) {
    await page.evaluate((catName) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((el) => (el.textContent || '').trim() === catName);
      if (b) b.click();
    }, cat);
    await new Promise((r) => setTimeout(r, 500));
    const safe = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await shot(page, `theme-settings-cat-${safe}.png`);
  }

  // ---- Custom CSS panel: try typing something ----
  console.log('\n=== Custom CSS panel interaction ===');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => (el.textContent || '').trim() === 'Custom CSS');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.click();
    await page.keyboard.type('.test-audit-marker { color: red; }');
    await new Promise((r) => setTimeout(r, 1200));
    await shot(page, 'theme-custom-css-typed.png');
  } else {
    console.log('  NO TEXTAREA FOUND in Custom CSS panel');
  }

  // ---- Layout mode categories ----
  console.log('\n=== Layout mode: iterate categories ===');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => /^layout$/i.test((el.textContent || '').trim()));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, 'theme-layout-mode-list.png');

  const layoutCats = await page.$$eval('button', (btns) =>
    btns
      .map((b) => (b.textContent || '').trim())
      .filter((t) =>
        [
          'Home tab', 'Menu', 'Homepage layout', 'Top bar layout', 'Header size', 'Footer layout',
          'Footer size', 'Product page layout', 'Cart layout', 'Checkout layout', 'Icon style',
          'Button shape', 'Button fill',
        ].includes(t),
      ),
  );
  console.log('  found layout categories:', layoutCats);
  for (const cat of layoutCats) {
    await page.evaluate((catName) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((el) => (el.textContent || '').trim() === catName);
      if (b) b.click();
    }, cat);
    await new Promise((r) => setTimeout(r, 500));
    const safe = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await shot(page, `theme-layout-cat-${safe}.png`);
  }

  // ---- Home tab presets: click "Default" preset thumbnail ----
  console.log('\n=== Home tab preset thumbnails ===');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => (el.textContent || '').trim() === 'Home tab');
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'theme-home-tab-before-preset.png');
  // Try to find "Templates" toggle first if there's a mode toggle
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('  Home tab panel text snippet:', bodyText.slice(0, 200).replace(/\n/g, ' | '));

  await browser.close();
  console.log('\n=== PHASE 1 DONE ===');
})();
