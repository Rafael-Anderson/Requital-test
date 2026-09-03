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
  await new Promise((r) => setTimeout(r, 1000));
}

async function run(vpName, vp) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[CONSOLE ERROR][${vpName}] ${msg.text()}`); });
  page.on('pageerror', (err) => console.log(`[PAGE ERROR][${vpName}] ${err.message}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`[HTTP ${res.status()}][${vpName}] ${res.request().method()} ${res.url()}`); });
  page.on('requestfailed', (req) => console.log(`[REQFAIL][${vpName}] ${req.url()} - ${req.failure()?.errorText}`));

  await page.setViewport(vp);
  await login(page);
  await page.goto(`${ADMIN}/settings/outlets/1/edit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, a, div'));
    const el = els.find((x) => x.textContent.trim() === 'Delivery Area' || (x.children.length===0 && /Delivery Area/.test(x.textContent)));
    // find the nav item containing "Delivery Area" text as a heading
    const candidates = Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && e.textContent.trim() === 'Delivery Area');
    if (candidates[0]) { candidates[0].closest('button,a,[role="button"],div')?.click(); return true; }
    return false;
  });
  console.log('Delivery Area tab clicked:', clicked);
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(SHOT_DIR, `outlets-delivery-area-tab-${vpName}.png`), fullPage: true });

  // Click "Add zone" / "New zone" button
  const zoneClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /new zone|add zone/i.test(x.textContent));
    if (b) { b.click(); return b.textContent.trim(); }
    return null;
  });
  console.log('Zone button clicked:', zoneClicked);
  if (zoneClicked) {
    await new Promise((r) => setTimeout(r, 2500));
    await page.screenshot({ path: path.join(SHOT_DIR, `outlets-zone-modal-map-${vpName}.png`), fullPage: true });

    const mapState = await page.evaluate(() => {
      const mapDivs = Array.from(document.querySelectorAll('div.h-64, div[class*="h-64"]'));
      return mapDivs.map((d) => ({
        className: d.className,
        hasGmStyle: !!d.querySelector('.gm-style'),
        childCount: d.children.length,
        innerHtmlLen: d.innerHTML.length,
      }));
    });
    console.log('Map div state:', JSON.stringify(mapState, null, 2));
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('Contains "Failed to load Google Maps":', bodyText.includes('Failed to load Google Maps'));

    // Try dragging the radius slider and clicking the map to verify interactivity
    const circleExists = await page.evaluate(() => {
      // Google maps overlay circles render as SVG path inside gm-style; hard to detect directly,
      // just check console for maps.googleapis errors captured separately.
      return !!document.querySelector('.gm-style');
    });
    console.log('gm-style rendered (map loaded):', circleExists);
  } else {
    console.log('Could not find New/Add zone button. Dumping page text for debug:');
    console.log(await page.evaluate(() => document.body.innerText.slice(0, 2000)));
  }

  await browser.close();
}

(async () => {
  await run('desktop', { width: 1440, height: 900 });
  await run('mobile', { width: 390, height: 844 });
})();
