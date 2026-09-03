const puppeteer = require('puppeteer');
const path = require('path');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${label}] CONSOLE ERROR:`, msg.text());
  });
  page.on('pageerror', (err) => console.log(`[${label}] PAGE ERROR:`, err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) console.log(`[${label}] HTTP ${res.status()}:`, res.url());
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
  console.log('  screenshot:', name);
}

async function clickByText(page, tag, text) {
  return page.evaluate(
    (tagName, t) => {
      const els = Array.from(document.querySelectorAll(tagName));
      const el = els.find((e) => (e.textContent || '').trim() === t);
      if (el) { el.click(); return true; }
      return false;
    },
    tag,
    text,
  );
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  attachListeners(page, 'theme');
  await page.setViewport({ width: 1440, height: 900 });

  console.log('=== Login ===');
  await page.goto(`${ADMIN}/login`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));
  await page.type('input[type="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 3000));
  console.log('  post-login URL:', page.url());

  console.log('\n=== Enter builder ===');
  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2500));
  console.log('  URL:', page.url());

  const iframeInfo = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return { found: false };
    return { found: true, src: f.src, w: f.offsetWidth, h: f.offsetHeight };
  });
  console.log('  iframe info:', iframeInfo);
  await shot(page, 'theme-iframe-debug.png');

  // Try to inspect the iframe's own document (same-origin? cross-port -> cross-origin, expect null)
  const frames = page.frames();
  console.log('  page.frames() count:', frames.length, frames.map((f) => f.url()));

  // ============ THEME SETTINGS MODE ============
  console.log('\n=== Theme Settings mode ===');
  await page.click('button[aria-label="Theme settings"]');
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, 'theme-settings-mode-list.png');

  const categoryLabels = [
    'Logo and favicon', 'Colors', 'Typography', 'Page layout', 'Animations', 'Badges',
    'Buttons', 'Cart', 'Drawers', 'Icons', 'Input fields', 'Popovers and modals', 'Prices',
    'Product cards', 'Search', 'Swatches', 'Variant pickers', 'Custom CSS', 'Collection page',
  ];
  for (const cat of categoryLabels) {
    const clicked = await clickByText(page, 'button', cat);
    if (!clicked) { console.log(`  category NOT FOUND: ${cat}`); continue; }
    await new Promise((r) => setTimeout(r, 350));
    const safe = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await shot(page, `theme-settings-cat-${safe}.png`);
  }

  console.log('\n=== Custom CSS interaction ===');
  await clickByText(page, 'button', 'Custom CSS');
  await new Promise((r) => setTimeout(r, 400));
  const textarea = await page.$('textarea');
  console.log('  textarea found:', !!textarea);
  if (textarea) {
    await textarea.click();
    await page.keyboard.type('.audit-marker{color:red}');
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, 'theme-custom-css-typed.png');
  }

  // ============ LAYOUT MODE ============
  console.log('\n=== Layout mode ===');
  await page.click('button[aria-label="Layout"]');
  await new Promise((r) => setTimeout(r, 600));
  await shot(page, 'theme-layout-mode-list.png');

  const layoutLabels = [
    'Home tab', 'Menu', 'Homepage layout', 'Top bar layout', 'Header size', 'Footer layout',
    'Footer size', 'Product page layout', 'Cart layout', 'Checkout layout', 'Icon style',
    'Button shape', 'Button fill',
  ];
  for (const cat of layoutLabels) {
    const clicked = await clickByText(page, 'button', cat);
    if (!clicked) { console.log(`  layout category NOT FOUND: ${cat}`); continue; }
    await new Promise((r) => setTimeout(r, 350));
    const safe = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await shot(page, `theme-layout-cat-${safe}.png`);
  }

  // Home tab presets
  console.log('\n=== Home tab presets ===');
  await clickByText(page, 'button', 'Home tab');
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'theme-home-tab-panel.png');
  const homeTabText = await page.evaluate(() => document.body.innerText);
  console.log('  contains Default/Minimal/Featured:', /Default/.test(homeTabText), /Minimal/.test(homeTabText), /Featured/.test(homeTabText));

  await browser.close();
  console.log('\n=== PHASE 3 DONE ===');
})();
