const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Log in via API, inject token.
  const loginRes = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test-shop.com', password: 'dev-password-123' }),
  });
  const { accessToken, refreshToken } = await loginRes.json();
  await page.evaluateOnNewDocument((at, rt) => {
    localStorage.setItem('requital_admin_access_token', at);
    localStorage.setItem('requital_admin_refresh_token', rt);
  }, accessToken, refreshToken);

  // --- Payments page: verify Nomod/Telr/PayTabs coming-soon rows ---
  await page.goto('http://localhost:3001/settings/business/payments', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[name="cardProcessor"]', { timeout: 15000 });
  const rows = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label')).filter((l) =>
      l.querySelector('input[name="cardProcessor"]'),
    );
    return labels.map((l) => ({
      text: l.textContent.trim(),
      disabled: l.querySelector('input').disabled,
      cursorClass: l.className.includes('cursor-not-allowed'),
    }));
  });
  console.log('PAYMENTS ROWS:', JSON.stringify(rows, null, 2));
  await page.screenshot({ path: 'screenshots/pr3-payments-coming-soon.png' });

  // --- Theme builder: verify Colors search filter fix ---
  const themesRes = await fetch('http://localhost:3000/themes', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const themes = await themesRes.json();
  const themeId = themes[0]?.id ?? 1;
  await page.goto(`http://localhost:3001/theme/${themeId}/builder`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('body', { timeout: 15000 });

  // Click "Theme settings" mode, then "Colors" category, then search "Text".
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Theme settings"]');
    if (btn) btn.click();
    return !!btn;
  });
  console.log('clicked Theme settings mode:', clicked);
  await new Promise((r) => setTimeout(r, 800));

  const clickedColors = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"], li'));
    const colorsBtn = buttons.find((b) => b.textContent.trim() === 'Colors');
    if (colorsBtn) colorsBtn.click();
    return !!colorsBtn;
  });
  console.log('clicked Colors category:', clickedColors);
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshots/pr3-colors-before-search.png' });

  const searchInput = await page.$('input[placeholder*="Search" i]');
  if (searchInput) {
    await searchInput.type('Text');
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: 'screenshots/pr3-colors-after-search-text.png' });
    const visibility = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span')).filter((s) =>
        ['Background', 'Text', 'Button', 'Button label', 'Secondary button label'].includes(s.textContent.trim()),
      );
      return spans.map((s) => ({
        label: s.textContent.trim(),
        visible: s.offsetParent !== null,
      }));
    });
    console.log('COLOR FIELD VISIBILITY AFTER SEARCHING "Text":', JSON.stringify(visibility, null, 2));
  } else {
    console.log('NO SEARCH INPUT FOUND');
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
