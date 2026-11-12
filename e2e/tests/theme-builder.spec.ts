import { test, expect, type Page } from '@playwright/test';
import { ADMIN_URL, API_URL } from '../urls';
import { seedShop, type SeedState } from '../seed';

// The theme builder's settings search and Layout list, in a real browser. Guards two things that
// jsdom cannot: the global search finds a setting that lives in a panel that is NOT open (and opens
// it), and, for a shop whose storefront is in Sections mode, the Layout list shows only entries that
// do something (no dead rows, no "Your storefront uses the Sections builder" pane).
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let seed: SeedState;
let themeId = 0;

test.beforeAll(async () => {
  // Its own shop: the shared fixture's admin password is changed by password-reset.spec.ts.
  seed = await seedShop();
});

async function loginAdmin(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await page.request.post(`${API_URL}/auth/login`, { data: { email: seed.adminEmail, password: seed.adminPassword } });
    if (res.ok()) return res;
    if (res.status() !== 429) throw new Error(`admin login failed: ${res.status()}`);
    await page.waitForTimeout(62_000);
  }
  throw new Error('admin login stayed throttled');
}

test('settings search opens a setting from another panel, and the Layout list hides dead entries', async ({ page }) => {
  const login = await loginAdmin(page);
  const csrf = { 'X-CSRF-Token': login.headers()['x-csrf-token'] ?? '' };
  const created = await page.request.post(`${API_URL}/themes`, { data: { name: 'Builder e2e', fromTemplate: 'atelier' }, headers: csrf });
  expect(created.ok(), `create theme: ${created.status()}`).toBe(true);
  themeId = ((await created.json()) as { id: number }).id;
  // A published Sections theme is what puts the storefront in Sections mode.
  const published = await page.request.post(`${API_URL}/themes/${themeId}/publish`, { data: {}, headers: csrf });
  expect(published.ok(), `publish theme: ${published.status()}`).toBe(true);

  await page.goto(`${ADMIN_URL}/theme/${themeId}/builder`);
  const search = page.getByPlaceholder('Search settings...');
  await expect(search).toBeVisible({ timeout: 90_000 });
  // The preview iframe deselects whatever is selected when its own document first mounts (a
  // pre-existing behaviour of PreviewInteraction), so let it finish loading before selecting.
  await expect(page.frameLocator('iframe').locator('header').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);

  // 1. A setting in a panel that is not open: Announcement bar > Speed.
  await search.fill('speed');
  const group = page.getByRole('group', { name: 'Announcement bar' });
  await expect(group).toBeVisible();
  await expect(group).toContainText('Speed');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Announcement bar' })).toBeVisible();
  await expect(page.getByText('Off means the bar is not shown on your storefront at all.')).toBeVisible();
  await expect(search).toHaveValue('');

  // 2. A section-level setting: Hero > Content position.
  await search.fill('content position');
  await page.getByRole('option', { name: /Content position/ }).click();
  await expect(page.getByRole('heading', { name: 'Hero' })).toBeVisible();
  await expect(page.getByText('Content position').first()).toBeVisible();
  // ...and the field itself is scrolled to and briefly highlighted.
  await expect(page.locator('.theme-search-highlight')).toContainText('Content position', { timeout: 3000 });

  // 3. Layout list: only what applies to a Sections-mode storefront.
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  for (const live of ['Home tab', 'Menu', 'Product page layout', 'Cart layout', 'Checkout layout', 'Icon style', 'Button shape', 'Button fill']) {
    await expect(page.getByRole('button', { name: live, exact: true })).toBeVisible();
  }
  for (const dead of ['Homepage layout', 'Top bar layout', 'Header size', 'Footer layout', 'Footer size']) {
    await expect(page.getByRole('button', { name: dead, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText(/uses the Sections builder/i)).toHaveCount(0);

  // 4. The search never offers an entry that does not apply.
  await search.fill('top bar');
  await expect(page.getByText('No settings match')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
});
