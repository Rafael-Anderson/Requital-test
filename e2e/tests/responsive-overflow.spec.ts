import { test, expect, type Page } from '@playwright/test';
import { ADMIN_URL, API_URL, STOREFRONT_URL } from '../urls';
import { readSeedState } from '../state';

// Phone-width regression guard. The failure it exists for: a page whose content is wider than the
// device. Chrome on a phone then zooms the visual viewport out, the 390px header covers only part of
// the screen and everything looks broken, while window.innerWidth quietly grows to the content width.
// So this compares documentElement.scrollWidth with documentElement.clientWidth (the layout viewport),
// never innerWidth. See tools/responsive-audit/README.md for the full harness.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.describe.configure({ mode: 'serial' });
// CI serves admin and storefront with `next dev`, which compiles each route on first visit.
test.setTimeout(150_000);

// The login route is throttled per IP (5 a minute) and the earlier specs have just used most of that
// window, so a 429 here means "wait for the window", not "broken". Bounded: three tries.
async function loginAdmin(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await page.request.post(`${API_URL}/auth/login`, { data: { email, password } });
    if (res.ok()) return res;
    if (res.status() !== 429) throw new Error(`admin login failed: ${res.status()}`);
    await page.waitForTimeout(62_000);
  }
  throw new Error('admin login stayed throttled');
}

async function settle(page: Page) {
  // Never waits unbounded: a page that polls forever (orders refreshes every 20s) still ends here.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector('.animate-pulse, [aria-busy="true"]'), null, { timeout: 5_000 })
    .catch(() => undefined);
}

async function expectNoOverflow(page: Page, label: string) {
  await settle(page);
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const logo = document.querySelector('a[aria-label="Requital home"]');
    const header = document.querySelector('header') ?? logo?.parentElement ?? null;
    return {
      clientWidth: de.clientWidth,
      scrollWidth: de.scrollWidth,
      headerWidth: header ? Math.round(header.getBoundingClientRect().width) : null,
    };
  });
  expect(m.scrollWidth, `${label}: document is ${m.scrollWidth}px wide in a ${m.clientWidth}px viewport`).toBeLessThanOrEqual(m.clientWidth + 1);
  if (m.headerWidth !== null) {
    expect(m.headerWidth, `${label}: header is ${m.headerWidth}px in a ${m.clientWidth}px viewport`).toBeGreaterThanOrEqual(m.clientWidth - 1);
  }
}

const ADMIN_ROUTES = [
  '/',
  '/dashboard',
  '/orders',
  '/orders/history',
  '/inventory',
  '/customers',
  '/settings',
  '/settings/business/information',
];

test('admin pages fit a 390px phone and keep a full-width header', async ({ page }) => {
  const seed = readSeedState();
  const login = await loginAdmin(page, seed.adminEmail, seed.adminPassword);
  // The advanced editor shows the full dashboard (branch and date-range filters), the widest layout.
  await page.request.patch(`${API_URL}/shop`, {
    data: { productEditorMode: 'advanced' },
    headers: { 'X-CSRF-Token': login.headers()['x-csrf-token'] ?? '' },
  });
  for (const route of ADMIN_ROUTES) {
    await page.goto(`${ADMIN_URL}${route}`);
    await expectNoOverflow(page, `admin ${route}`);
  }
});

test('storefront pages fit a 390px phone', async ({ page }) => {
  const seed = readSeedState();
  const base = `${STOREFRONT_URL}/${seed.subdomain}`;
  for (const route of ['', '/cart', `/products/${seed.simpleProduct.slug}`]) {
    await page.goto(`${base}${route}`);
    await expectNoOverflow(page, `storefront ${route || '/'}`);
  }
});
