import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { ADMIN_URL, API_URL } from '../urls';
import { seedShop, type SeedState } from '../seed';

// The theme builder shell in a real browser: one left panel (Sections / Design / Settings) whose
// rows drill in to the item's settings in the same panel, a preview that selects back into it, the
// registry-driven global search, the menu editor's modal, and no entry that does nothing for a
// Sections-mode storefront. Uses its own throwaway shop with a published Sections theme.
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let seed: SeedState;
let themeId = 0;
let csrf: Record<string, string> = {};

test.beforeAll(async () => {
  // seedShop waits out the per-IP signup and verify-email limits (bounded); the
  // hook gets its own timeout, the file-level one is not it.
  test.setTimeout(150_000);
  // Its own shop: the shared fixture's admin password is changed by password-reset.spec.ts.
  seed = await seedShop();
});

async function loginAdmin(page: Page): Promise<APIResponse> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await page.request.post(`${API_URL}/auth/login`, { data: { email: seed.adminEmail, password: seed.adminPassword } });
    if (res.ok()) return res;
    if (res.status() !== 429) throw new Error(`admin login failed: ${res.status()}`);
    await page.waitForTimeout(62_000);
  }
  throw new Error('admin login stayed throttled');
}

interface DraftSection {
  id: string;
  type: string;
  visible: boolean;
  order: number;
}

async function draftConfig(page: Page): Promise<{ sections: DraftSection[]; header: { settings: Record<string, unknown> } }> {
  const res = await page.request.get(`${API_URL}/themes/${themeId}`);
  expect(res.ok(), `get theme: ${res.status()}`).toBe(true);
  return ((await res.json()) as { config: { sections: DraftSection[]; header: { settings: Record<string, unknown> } } }).config;
}

async function sectionIdOf(page: Page, type: string): Promise<string> {
  const section = (await draftConfig(page)).sections.find((s) => s.type === type);
  if (!section) throw new Error(`no ${type} section`);
  return section.id;
}

async function openBuilder(page: Page, query = '') {
  await page.goto(`${ADMIN_URL}/theme/${themeId}/builder${query}`);
  await expect(page.getByRole('tab', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
  // The preview mounts its storefront; let it finish loading before interacting.
  await expect(page.frameLocator('iframe').locator('header').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
}

const panel = (page: Page) => page.getByTestId('builder-panel');
const drillIn = (page: Page) => page.getByTestId('builder-drill-in');
const sectionsList = (page: Page) => page.getByTestId('builder-list-sections');

test('set up: a published Sections theme', async ({ page }) => {
  const login = await loginAdmin(page);
  csrf = { 'X-CSRF-Token': login.headers()['x-csrf-token'] ?? '' };
  const created = await page.request.post(`${API_URL}/themes`, { data: { name: 'Builder e2e', fromTemplate: 'atelier' }, headers: csrf });
  expect(created.ok(), `create theme: ${created.status()}`).toBe(true);
  themeId = ((await created.json()) as { id: number }).id;
  // A published Sections theme is what puts the storefront in Sections mode.
  const published = await page.request.post(`${API_URL}/themes/${themeId}/publish`, { data: {}, headers: csrf });
  expect(published.ok(), `publish theme: ${published.status()}`).toBe(true);
});

test('a section opens in the same drill-in from the tree, from a preview click and from search', async ({ page }) => {
  await loginAdmin(page);
  await openBuilder(page);
  const richTextId = await sectionIdOf(page, 'rich_text');

  // 1. From the tree.
  await sectionsList(page).getByRole('button', { name: 'Rich Text', exact: true }).click();
  await expect(drillIn(page).getByRole('heading', { name: 'Rich Text' })).toBeVisible();
  await expect(drillIn(page)).toContainText(/Template · Section \d+ of \d+/);
  await expect(page).toHaveURL(new RegExp(`node=${richTextId}`));
  await drillIn(page).getByRole('button', { name: 'Back' }).click();
  await expect(drillIn(page)).toHaveCount(0);

  // 2. From a click on the section in the preview (away from its drag handle and its blocks).
  const target = page.frameLocator('iframe').locator(`[data-requital-section-id="${richTextId}"]`);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('rich text section not rendered in the preview');
  await target.click({ position: { x: box.width - 12, y: 12 } });
  await expect(drillIn(page).getByRole('heading', { name: 'Rich Text' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`node=${richTextId}`));
  // The selected section gets a name chip and a toolbar on the preview.
  await expect(page.getByTestId('preview-selection-chip')).toHaveText('Rich Text');
  await expect(page.getByTestId('preview-selection-toolbar')).toBeVisible();
  // Focus is inside the preview after that click; Escape is the admin's, so focus the panel first.
  await drillIn(page).getByRole('button', { name: 'Back' }).focus();
  await page.keyboard.press('Escape');
  await expect(drillIn(page)).toHaveCount(0);

  // 3. From the global search (Ctrl+K focuses it).
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Search settings...');
  await expect(search).toBeFocused();
  await search.fill('content width');
  await page.getByRole('option', { name: /Content width/ }).click();
  await expect(drillIn(page).getByRole('heading', { name: 'Rich Text' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`node=${richTextId}`));
  await expect(page.locator('.theme-search-highlight')).toContainText('Content width', { timeout: 3000 });
});

test('Back (and the browser back button) returns to the tree with its scroll position kept', async ({ page }) => {
  await loginAdmin(page);
  await page.setViewportSize({ width: 1440, height: 560 });
  await openBuilder(page);
  // Expand every template section so the tree is taller than the panel.
  const expanders = sectionsList(page).getByRole('button', { name: /^Expand / });
  for (let i = 0; i < 20 && (await expanders.count()) > 0; i++) await expanders.first().click();
  const list = sectionsList(page);
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const before = await list.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(50);

  await list.getByRole('button', { name: 'Footer', exact: true }).click();
  await expect(drillIn(page).getByRole('heading', { name: 'Footer' })).toBeVisible();
  await drillIn(page).getByRole('button', { name: 'Back' }).click();
  await expect(list).toBeVisible();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(before);

  await list.getByRole('button', { name: 'Footer', exact: true }).click();
  await expect(drillIn(page)).toBeVisible();
  await page.goBack();
  await expect(drillIn(page)).toHaveCount(0);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(before);
});

test('the eye hides a section in the preview, and a reorder persists', async ({ page }) => {
  await loginAdmin(page);
  await openBuilder(page);
  const heroId = await sectionIdOf(page, 'hero');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator(`[data-requital-section-id="${heroId}"]`)).toHaveCount(1);

  await sectionsList(page).getByRole('button', { name: 'Hide Hero' }).click();
  await expect(sectionsList(page).getByRole('button', { name: 'Show Hero' })).toBeVisible();
  await expect(frame.locator(`[data-requital-section-id="${heroId}"]`)).toHaveCount(0);
  await sectionsList(page).getByRole('button', { name: 'Show Hero' }).click();
  await expect(frame.locator(`[data-requital-section-id="${heroId}"]`)).toHaveCount(1);

  // Keyboard drag (dnd-kit's keyboard sensor): move Hero down one place. A reorder saves at once.
  const orderBefore = (await draftConfig(page)).sections.sort((a, b) => a.order - b.order).map((s) => s.id);
  const heroIndex = orderBefore.indexOf(heroId);
  await sectionsList(page).getByRole('button', { name: 'Drag to reorder Hero' }).focus();
  // dnd-kit measures between keyboard steps: give it a moment after each one.
  for (const key of ['Space', 'ArrowDown', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(300);
  }
  await expect
    .poll(async () => (await draftConfig(page)).sections.sort((a, b) => a.order - b.order).map((s) => s.id).indexOf(heroId), { timeout: 15_000 })
    .toBe(heroIndex + 1);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
  const rows = await sectionsList(page).locator('[data-section-row^="sec-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section-row')));
  expect(rows.indexOf(heroId)).toBe(heroIndex + 1);
});

test('the announcement bar is the first Header row, and its On/Off and Speed work from the Sections tab', async ({ page }) => {
  await loginAdmin(page);
  await openBuilder(page);
  const header = sectionsList(page).getByRole('region', { name: 'Header' });
  await expect(header.locator('[data-section-row]').first()).toHaveAttribute('data-section-row', '__announcement__');

  await header.getByRole('button', { name: 'Announcement bar', exact: true }).click();
  await expect(drillIn(page).getByRole('heading', { name: 'Announcement bar' })).toBeVisible();
  const switches = drillIn(page).getByRole('switch');
  if ((await switches.first().getAttribute('aria-checked')) !== 'true') await switches.first().click();
  await expect(switches.first()).toHaveAttribute('aria-checked', 'true');
  // Scrolling on, then the Speed slider one step faster.
  await switches.nth(1).click();
  const speed = drillIn(page).getByRole('slider', { name: /Speed/ });
  await expect(speed).toBeVisible();
  await speed.focus();
  await page.keyboard.press('ArrowRight');
  await expect(drillIn(page).getByRole('button', { name: /Use default/ })).toBeVisible();

  await drillIn(page).getByRole('button', { name: 'Back' }).click();
  await expect(header.getByRole('button', { name: 'Hide Announcement bar' })).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect
    .poll(async () => (await draftConfig(page)).header.settings.announcementBar as Record<string, unknown> | undefined, { timeout: 20_000 })
    .toMatchObject({ enabled: true, scrolling: true, marqueeSpeed: 45, managed: true });
});

test('the menu editor opens in a modal and a mega menu round-trips a save', async ({ page }) => {
  await loginAdmin(page);
  await openBuilder(page, '?panel=settings&open=layout%3AMenu');
  await expect(drillIn(page).getByRole('heading', { name: 'Menu' })).toBeVisible();
  await drillIn(page).getByRole('button', { name: 'Edit menu' }).click();
  const modal = page.getByRole('dialog', { name: 'Menu' });
  await expect(modal).toBeVisible();

  await modal.getByRole('button', { name: 'Add item' }).click();
  await modal.getByLabel('Label', { exact: true }).fill('Shop');
  await modal.getByRole('button', { name: 'Mega menu', exact: true }).click();
  await modal.getByRole('button', { name: 'Add column' }).click();
  await modal.getByLabel('Column title').fill('Flowers');
  await modal.getByRole('button', { name: 'Add link' }).click();
  await modal.getByLabel('Link label').fill('Sale');
  await modal.getByRole('button', { name: 'Custom URL', exact: true }).click();
  await modal.getByLabel('Custom URL').fill('https://example.com/sale');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal.getByText('Mega menu · 1 column')).toBeVisible({ timeout: 15_000 });

  const saved = await page.request.get(`${API_URL}/menu-items`);
  expect(saved.ok()).toBe(true);
  const items = (await saved.json()) as { label: string; type: string; columns: { title: string; links: { label: string; customUrl: string | null }[] }[] }[];
  const shop = items.find((i) => i.label === 'Shop');
  expect(shop?.type).toBe('MEGA');
  expect(shop?.columns[0].title).toBe('Flowers');
  expect(shop?.columns[0].links[0]).toMatchObject({ label: 'Sale', customUrl: 'https://example.com/sale' });

  // Re-open the saved item: the editor shows exactly what was saved.
  await modal.getByRole('button', { name: /^Shop/ }).click();
  await expect(modal.getByLabel('Column title')).toHaveValue('Flowers');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await modal.getByRole('button', { name: 'Close' }).last().click();
  await expect(modal).toHaveCount(0);
  await expect(drillIn(page).getByTestId('menu-summary')).toContainText('Shop');
});

test('a Sections-mode storefront: no entry that does nothing is listed or found', async ({ page }) => {
  await loginAdmin(page);
  await openBuilder(page);

  await panel(page).getByRole('tab', { name: 'Design' }).click();
  const design = page.getByTestId('builder-list-design');
  for (const live of ['Colors', 'Typography', 'Product page layout', 'Cart layout', 'Icon style', 'Button shape', 'Button fill']) {
    await expect(design.getByRole('button', { name: live, exact: true })).toBeVisible();
  }
  for (const dead of ['Homepage layout', 'Top bar layout', 'Header size', 'Footer layout', 'Footer size']) {
    await expect(page.getByRole('button', { name: dead, exact: true })).toHaveCount(0);
  }
  await expect(design.getByText('Only settings that apply to your theme are shown')).toBeVisible();

  await panel(page).getByRole('tab', { name: 'Settings' }).click();
  const settings = page.getByTestId('builder-list-settings');
  for (const live of ['Menu', 'Home tab']) await expect(settings.getByRole('button', { name: live, exact: true })).toBeVisible();
  await expect(page.getByText(/uses the Sections builder/i)).toHaveCount(0);

  // A deep link to a hidden entry falls back to the list, never a dead pane.
  await openBuilder(page, '?panel=design&open=layout%3AHomepage%20layout');
  await expect(drillIn(page)).toHaveCount(0);
  await expect(page.getByTestId('builder-list-design')).toBeVisible();

  // The search never offers an entry that does not apply.
  const search = page.getByPlaceholder('Search settings...');
  await search.fill('top bar');
  await expect(page.getByText('No settings match')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');

  // ...but finds one in a panel that is not open, and opens it: Announcement bar > Speed.
  await search.fill('speed');
  const group = page.getByRole('group', { name: 'Announcement bar' });
  await expect(group).toContainText('Speed');
  await search.press('Enter');
  await expect(drillIn(page).getByRole('heading', { name: 'Announcement bar' })).toBeVisible();
  await expect(page.getByText('Off means the bar is not shown on your storefront at all.')).toBeVisible();
});
