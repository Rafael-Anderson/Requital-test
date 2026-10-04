import { test, expect, type Page } from '@playwright/test';
import { ADMIN_URL, API_URL, STOREFRONT_URL } from '../urls';
import { seedShop, type SeedState } from '../seed';

// Phone-width regression guard. The failure it exists for: a page whose content is wider than the
// device. Chrome on a phone then zooms the visual viewport out, the 390px header covers only part of
// the screen and everything looks broken, while window.innerWidth quietly grows to the content width.
// So this compares documentElement.scrollWidth with documentElement.clientWidth (the layout viewport),
// never innerWidth. See tools/responsive-audit/README.md for the full harness.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.describe.configure({ mode: 'serial' });
// This spec seeds its OWN shop: the shared fixture's admin password is changed by password-reset.spec.ts,
// which runs before this file, so logging in as that admin here would be a 401.
let seed: SeedState;
test.beforeAll(async () => {
  seed = await seedShop();
});

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
  const base = `${STOREFRONT_URL}/${seed.subdomain}`;
  for (const route of ['', '/cart', `/products/${seed.simpleProduct.slug}`]) {
    await page.goto(`${base}${route}`);
    await expectNoOverflow(page, `storefront ${route || '/'}`);
  }
});

// The home page of each starter template. Their sections enter with sideways or rotated transforms
// (slide-left, rotate-in, staggered children); when such an entrance finishes, Chrome can leave the
// page's scrollWidth at a mid-animation value a few px past the viewport, so the whole page drags
// sideways on a phone. A freshly loaded home is checked first, then again after scrolling through it
// (below-the-fold sections only animate once they are reached), each time after every finite
// animation has finished.
const TEMPLATES = ['atelier', 'market', 'bloom', 'heritage'] as const;

async function expectHomeFits(page: Page, label: string) {
  await settle(page);
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.playState === 'finished' || a.effect?.getComputedTiming().iterations === Infinity),
    null,
    { timeout: 10_000 },
  );
  const m = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(m.scrollWidth, `${label}: document is ${m.scrollWidth}px wide in a ${m.clientWidth}px viewport`).toBeLessThanOrEqual(m.clientWidth);
}

test('storefront home fits a 390px phone on every starter template', async ({ page }) => {
  test.setTimeout(300_000);
  const login = await loginAdmin(page, seed.adminEmail, seed.adminPassword);
  const csrf = { 'X-CSRF-Token': login.headers()['x-csrf-token'] ?? '' };
  for (const template of TEMPLATES) {
    const created = await page.request.post(`${API_URL}/themes`, { data: { name: `Overflow ${template}`, fromTemplate: template }, headers: csrf });
    expect(created.ok(), `create ${template} theme: ${created.status()}`).toBe(true);
    const { id } = (await created.json()) as { id: number };
    const published = await page.request.post(`${API_URL}/themes/${id}/publish`, { data: {}, headers: csrf });
    expect(published.ok(), `publish ${template} theme: ${published.status()}`).toBe(true);

    await page.goto(`${STOREFRONT_URL}/${seed.subdomain}`);
    await expectHomeFits(page, `storefront home, ${template}, on load`);
    for (let y = 0; y < (await page.evaluate(() => document.documentElement.scrollHeight)); y += 400) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);
    }
    await expectHomeFits(page, `storefront home, ${template}, after scrolling`);
  }
});
