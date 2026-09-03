const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';
const session = JSON.parse(fs.readFileSync(path.join(__dirname, 'session.json'), 'utf8'));

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[${label}] CONSOLE ERROR:`, msg.text().slice(0, 300));
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

async function getSectionOrder(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-section-row]'));
    return rows
      .map((r) => r.getAttribute('data-section-row'))
      .filter((id) => id && id !== '__header__' && id !== '__footer__');
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  attachListeners(page, 'theme');
  await page.setViewport({ width: 1440, height: 900 });

  console.log('=== Inject session (avoid login throttle) ===');
  await page.evaluateOnNewDocument((s) => {
    localStorage.setItem('requital_admin_access_token', s.access);
    localStorage.setItem('requital_admin_refresh_token', s.refresh);
  }, session);
  await page.goto(`${ADMIN}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('  post-inject URL:', page.url());

  console.log('\n=== Enter builder, wait for iframe to fully load ===');
  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 4000));
  await shot(page, 'p4-01-initial-loaded.png');

  // ---- 1) Confirm Product Cards crash reproducibility (one more time, cleanly) ----
  console.log('\n=== Confirm Product Cards crash ===');
  await page.click('button[aria-label="Theme settings"]');
  await new Promise((r) => setTimeout(r, 500));
  await clickByText(page, 'button', 'Product cards');
  await new Promise((r) => setTimeout(r, 800));
  const crashText = await page.evaluate(() => document.body.innerText);
  console.log('  crashed:', /Something went wrong/.test(crashText));
  await shot(page, 'p4-02-product-cards-crash.png');

  // Reload to recover.
  console.log('\n=== Reload to recover from crash ===');
  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 3500));
  await shot(page, 'p4-03-recovered.png');

  // ---- 2) Drag-and-drop reorder test ----
  console.log('\n=== Drag-and-drop reorder test ===');
  const before = await getSectionOrder(page);
  console.log('  order before:', before);

  const handles = await page.$$('button[aria-label="Drag to reorder"]');
  console.log('  drag handles found:', handles.length);
  if (handles.length >= 2) {
    const h0 = await handles[0].boundingBox();
    const h1 = await handles[1].boundingBox();
    console.log('  handle0 box:', h0, 'handle1 box:', h1);
    // Drag handle 0 (first section, Hero normally) down past handle 1's row.
    const startX = h0.x + h0.width / 2;
    const startY = h0.y + h0.height / 2;
    const endX = h1.x + h1.width / 2;
    const endY = h1.y + h1.height + 10; // past the second row's bottom
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Intermediate steps to exceed dnd-kit's activation distance and trigger sorting.
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      await page.mouse.move(x, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 200));
    await shot(page, 'p4-04-mid-drag.png');
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 800));
  }
  const after = await getSectionOrder(page);
  console.log('  order after drag:', after);
  await shot(page, 'p4-05-after-drag.png');

  // Reload the WHOLE page (hard nav) to test persistence (the historical "snap back" bug).
  console.log('\n=== Reload to test drag persistence ===');
  await page.goto(`${ADMIN}/theme/1/builder`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 3500));
  const afterReload = await getSectionOrder(page);
  console.log('  order after full reload:', afterReload);
  console.log('  PERSISTED:', JSON.stringify(after) === JSON.stringify(afterReload));
  await shot(page, 'p4-06-after-reload.png');

  // ---- 3) Preview page switcher ----
  console.log('\n=== Preview page switcher ===');
  const selectEl = await page.$('select');
  if (selectEl) {
    const options = await page.$$eval('select option', (opts) => opts.map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled })));
    console.log('  page switcher options:', options);
    // Switch to Collection page.
    const collectionOpt = options.find((o) => /Collection/.test(o.text) && !o.disabled);
    if (collectionOpt) {
      await page.select('select', collectionOpt.value);
      await new Promise((r) => setTimeout(r, 2000));
      await shot(page, 'p4-07-preview-collection-page.png');
      const iframeSrc = await page.evaluate(() => document.querySelector('iframe')?.src);
      console.log('  iframe src after switch:', iframeSrc);
    }
    // Switch to Product page.
    const productOpt = options.find((o) => /Product/.test(o.text) && !o.disabled);
    if (productOpt) {
      await page.select('select', productOpt.value);
      await new Promise((r) => setTimeout(r, 2000));
      await shot(page, 'p4-08-preview-product-page.png');
    }
    // Back to home.
    await page.select('select', '');
    await new Promise((r) => setTimeout(r, 1500));
  } else {
    console.log('  NO SELECT FOUND for page switcher');
  }

  // ---- 4) Search settings ----
  console.log('\n=== Search settings box ===');
  await page.click('button[aria-label="Theme settings"]');
  await new Promise((r) => setTimeout(r, 400));
  await clickByText(page, 'button', 'Colors');
  await new Promise((r) => setTimeout(r, 400));
  const searchInput = await page.$('input[placeholder="Search settings..."]');
  console.log('  search input found:', !!searchInput);
  if (searchInput) {
    await searchInput.click();
    await page.keyboard.type('background');
    await new Promise((r) => setTimeout(r, 500));
    await shot(page, 'p4-09-search-filtered.png');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
  }

  // ---- 5) Double-click select in preview iframe ----
  console.log('\n=== Double-click select in preview iframe ===');
  await page.click('button[aria-label="Sections"]');
  await new Promise((r) => setTimeout(r, 500));
  const frameHandle = await page.$('iframe');
  const frame = frameHandle ? await frameHandle.contentFrame() : null;
  console.log('  got content frame:', !!frame);
  if (frame) {
    try {
      await frame.waitForSelector('[data-requital-editable="true"]', { timeout: 8000 });
      const el = await frame.$('[data-requital-editable="true"]');
      const box = await el.boundingBox();
      console.log('  editable element box:', box);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 1 });
        await new Promise((r) => setTimeout(r, 800));
        await shot(page, 'p4-10-preview-element-selected.png');
      }
    } catch (e) {
      console.log('  no editable element found / timeout:', e.message);
      await shot(page, 'p4-10-preview-no-editable.png');
    }
  }

  // ---- 6) Home tab presets: click "Default" ----
  console.log('\n=== Home tab preset click ===');
  await page.click('button[aria-label="Layout"]');
  await new Promise((r) => setTimeout(r, 400));
  await clickByText(page, 'button', 'Home tab');
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, 'p4-11-home-tab-before-click.png');
  const bodyTextHomeTab = await page.evaluate(() => document.body.innerText);
  console.log('  Home tab body has Default/Minimal/Featured:', /Default/.test(bodyTextHomeTab), /Minimal/.test(bodyTextHomeTab), /Featured/.test(bodyTextHomeTab));

  const beforePresetSections = await (async () => {
    await page.click('button[aria-label="Sections"]');
    await new Promise((r) => setTimeout(r, 400));
    const order = await getSectionOrder(page);
    await page.click('button[aria-label="Layout"]');
    await clickByText(page, 'button', 'Home tab');
    await new Promise((r) => setTimeout(r, 400));
    return order;
  })();
  console.log('  sections before preset click:', beforePresetSections);

  const presetClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((el) => (el.textContent || '').trim() === 'Minimal');
    if (b) { b.click(); return true; }
    return false;
  });
  console.log('  Minimal preset button clicked:', presetClicked);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(page, 'p4-12-home-tab-after-preset-click.png');

  await page.click('button[aria-label="Sections"]');
  await new Promise((r) => setTimeout(r, 500));
  const afterPresetSections = await getSectionOrder(page);
  console.log('  sections after "Minimal" preset:', afterPresetSections);
  await shot(page, 'p4-13-sections-after-preset.png');

  await browser.close();
  console.log('\n=== PHASE 4 DONE ===');
})();
