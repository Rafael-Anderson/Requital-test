const puppeteer = require('puppeteer');
const path = require('path');

const SHOT_DIR = path.join(__dirname, 'screenshots');
const ADMIN = 'http://localhost:3001';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

function attachListeners(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[CONSOLE ERROR][${label}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.log(`[PAGE ERROR][${label}] ${err.message}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[HTTP ${res.status()}][${label}] ${res.request().method()} ${res.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    console.log(`[REQUEST FAILED][${label}] ${req.url()} - ${req.failure()?.errorText}`);
  });
}

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

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
  console.log(`  -> screenshot: ${name}`);
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  attachListeners(page, 'main');

  console.log('=== Logging in ===');
  await login(page);
  await shot(page, 'outlets-00-after-login-desktop.png');

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    console.log(`\n\n########## VIEWPORT: ${vpName} (${vp.width}x${vp.height}) ##########`);
    await page.setViewport(vp);

    // ---- Outlets list ----
    console.log('\n=== Settings > Outlets ===');
    await page.goto(`${ADMIN}/settings/outlets`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, `outlets-list-${vpName}.png`);

    // Open "New outlet" modal
    try {
      const newBtn = await page.$x ? null : null;
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find((x) => x.textContent.includes('New outlet'));
        if (b) { b.click(); return true; }
        return false;
      });
      if (clicked) {
        await new Promise((r) => setTimeout(r, 600));
        await shot(page, `outlets-new-modal-${vpName}.png`);
        // close it
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const b = btns.find((x) => x.textContent.trim() === 'Cancel');
          if (b) b.click();
        });
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.log('  [WARN] Could not find "New outlet" button');
      }
    } catch (e) {
      console.log('  [ERROR] outlet modal: ' + e.message);
    }

    // Go to first outlet edit page (for delivery zone map)
    let outletEditUrl = null;
    try {
      outletEditUrl = await page.evaluate(() => {
        const link = document.querySelector('a[href*="/settings/outlets/"][href$="/edit"]');
        return link ? link.getAttribute('href') : null;
      });
    } catch (e) {}

    if (outletEditUrl) {
      console.log(`\n=== Outlet edit page: ${outletEditUrl} ===`);
      await page.goto(`${ADMIN}${outletEditUrl}`, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, `outlets-edit-${vpName}.png`);

      // Try to find and click a "Delivery" or zones tab, and MapPicker for outlet location
      const tabClicked = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('button, a'));
        const el = els.find((x) => /delivery/i.test(x.textContent) && x.textContent.length < 40);
        if (el) { el.click(); return el.textContent; }
        return null;
      });
      if (tabClicked) {
        console.log(`  clicked tab: ${tabClicked}`);
        await new Promise((r) => setTimeout(r, 800));
        await shot(page, `outlets-edit-delivery-tab-${vpName}.png`);

        // Try to open "New zone" modal for delivery zone map
        const zoneClicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const b = btns.find((x) => /new zone/i.test(x.textContent));
          if (b) { b.click(); return true; }
          return false;
        });
        if (zoneClicked) {
          console.log('  clicked "New zone" - waiting for map to load...');
          await new Promise((r) => setTimeout(r, 2500));
          await shot(page, `outlets-delivery-zone-map-${vpName}.png`);

          // Check whether the google map canvas actually rendered
          const mapState = await page.evaluate(() => {
            const mapDivs = Array.from(document.querySelectorAll('div[class*="h-64"]'));
            return mapDivs.map((d) => ({
              className: d.className,
              hasGmStyle: !!d.querySelector('.gm-style'),
              childCount: d.children.length,
              innerHtmlLen: d.innerHTML.length,
            }));
          });
          console.log('  Map div state:', JSON.stringify(mapState));

          const failedText = await page.evaluate(() => document.body.innerText.includes('Failed to load Google Maps'));
          console.log('  "Failed to load Google Maps" text present:', failedText);
        } else {
          console.log('  [WARN] Could not find "New zone" button');
        }
      } else {
        console.log('  [WARN] Could not find a Delivery tab on outlet edit page');
      }
    } else {
      console.log('  [WARN] No outlet edit link found on list page');
    }

    // ---- Business Information (incl. MapPicker for outlet address, WhatsApp) ----
    console.log('\n=== Settings > Business > Information ===');
    await page.goto(`${ADMIN}/settings/business/information`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1000));
    await shot(page, `settings-business-information-${vpName}.png`);

    // ---- Store configuration ----
    console.log('\n=== Settings > Business > Store Configuration ===');
    await page.goto(`${ADMIN}/settings/business/store-configuration`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, `settings-store-configuration-${vpName}.png`);

    // ---- Payments ----
    console.log('\n=== Settings > Business > Payments ===');
    await page.goto(`${ADMIN}/settings/business/payments`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, `settings-payments-${vpName}.png`);

    // ---- Users / Staff & Branch Roles ----
    console.log('\n=== Settings > Users ===');
    await page.goto(`${ADMIN}/settings/users`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, `settings-users-${vpName}.png`);

    // try opening "New branch account"
    const newUserClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((x) => /new branch account/i.test(x.textContent));
      if (b && !b.disabled) { b.click(); return true; }
      return false;
    });
    if (newUserClicked) {
      await new Promise((r) => setTimeout(r, 600));
      await shot(page, `settings-users-new-account-modal-${vpName}.png`);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find((x) => x.textContent.trim() === 'Cancel');
        if (b) b.click();
      });
      await new Promise((r) => setTimeout(r, 400));
    }

    // try opening "New branch role"
    const newRoleClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((x) => /new branch role/i.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    if (newRoleClicked) {
      await new Promise((r) => setTimeout(r, 600));
      await shot(page, `settings-users-new-role-modal-${vpName}.png`);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find((x) => x.textContent.trim() === 'Cancel');
        if (b) b.click();
      });
      await new Promise((r) => setTimeout(r, 400));
    }

    // ---- Jobs ----
    console.log('\n=== Settings > Jobs (Failed Jobs) ===');
    await page.goto(`${ADMIN}/settings/jobs`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, `settings-jobs-${vpName}.png`);
  }

  console.log('\n\n=== DONE ===');
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
