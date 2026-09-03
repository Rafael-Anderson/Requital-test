const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle2' });
  await page.type('input[type="email"], input[name="email"]', 'admin@test-shop.com');
  await page.type('input[type="password"]', 'dev-password-123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('after login url:', page.url());

  await page.goto('http://localhost:3001/settings/business/information', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshots/setup-business-info.png', fullPage: true });

  // Find the publish toggle button near "Publish your store" text
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Contains "Publish your store":', bodyText.includes('Publish your store'));
  console.log('Contains "Store published":', bodyText.includes('Store published'));

  if (bodyText.includes('Publish your store')) {
    // Click the toggle - find button role near the publish card
    const clicked = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('*'));
      const label = cards.find((el) => el.textContent.trim() === 'Publish your store' && el.children.length === 0);
      if (!label) return 'no-label';
      let card = label.closest('div');
      // climb up to find a button within reasonable distance
      for (let i = 0; i < 5 && card; i++) {
        const btn = card.querySelector('button[role="switch"], button');
        if (btn) {
          btn.click();
          return 'clicked:' + (btn.outerHTML.slice(0, 100));
        }
        card = card.parentElement;
      }
      return 'no-button-found';
    });
    console.log('toggle click result:', clicked);
    await new Promise((r) => setTimeout(r, 2000));
    const bodyText2 = await page.evaluate(() => document.body.innerText);
    console.log('After click, contains "Store published":', bodyText2.includes('Store published'));
    await page.screenshot({ path: 'screenshots/setup-after-publish-click.png', fullPage: true });
  }

  await browser.close();
})();
