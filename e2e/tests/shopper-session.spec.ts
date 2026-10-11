import { test, expect, type Page } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { api, seedShop, type SeedState } from '../seed';

// A shopper's session has to survive a page load. The failure this guards shipped to production:
// the customer cookies were scoped `Path=/public/<slug>` but the storefront's browser code calls the
// API as the same-origin `/api/public/<slug>/...`, so the browser never sent the cookie back. Login
// "worked" (the response body carried the customer), then the next page load, the wishlist and store
// credit all behaved as signed out. The backend e2e specs call the API directly and could not see it,
// and the wishlist hides it further (a signed-out wishlist falls back to localStorage), so this walks
// the real path in a real browser and asks the SERVER, through the page's own origin, who it thinks
// the shopper is.
test.describe.configure({ mode: 'serial' });
// CI serves the storefront with `next dev`, which compiles each route on first visit.
test.setTimeout(120_000);

let seed: SeedState;
test.beforeAll(async () => {
  // Own shop: publishing a theme changes the shop the other specs in this run use, and the wishlist
  // heart is a theme setting (Bloom turns it on).
  seed = await seedShop();
  const theme = await api<{ id: number }>(
    '/themes',
    { method: 'POST', body: JSON.stringify({ name: 'Shopper session', fromTemplate: 'bloom' }) },
    seed.session,
  );
  await api(`/themes/${theme.id}/publish`, { method: 'POST', body: JSON.stringify({}) }, seed.session);
});

// The register form's labels are not bound to their inputs, so fields are addressed by position:
// name, phone, email (optional), password.
async function register(page: Page, name: string, phone: string) {
  const fields = page.locator('form input');
  await expect(fields.first()).toBeVisible({ timeout: 60_000 });
  await fields.nth(0).fill(name);
  await fields.nth(1).fill(phone);
  await fields.nth(3).fill('Wishlist-Session-9x!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
}

const base = () => `${STOREFRONT_URL}/${seed.subdomain}`;

// What the server thinks of this browser, asked the way the page asks (relative /api, cookies attached
// by the browser). Never reads document.cookie: the cookies are httpOnly.
async function serverWishlist(page: Page): Promise<{ status: number; ids: number[] }> {
  return page.evaluate(async (slug) => {
    const res = await fetch(`/api/public/${slug}/account/wishlist`, { credentials: 'include' });
    const body = res.ok ? ((await res.json()) as unknown) : null;
    return { status: res.status, ids: Array.isArray(body) ? (body as number[]) : [] };
  }, seed.subdomain);
}

test('a shopper stays signed in across a reload, keeps a server-side wishlist, and signing out ends the session', async ({ page }) => {
  const phone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  await page.goto(`${base()}/account/register`);
  await register(page, 'Session Shopper', phone);
  // Straight after signing in, before anything else could mask it.
  expect((await serverWishlist(page)).status, 'the server did not recognise the shopper right after sign-in').toBe(200);

  // The wishlist heart (Bloom enables it) on the home page's product grid.
  await page.goto(base());
  const add = page.getByRole('button', { name: 'Add to wishlist' }).first();
  await expect(add).toBeVisible({ timeout: 30_000 });
  const posted = page.waitForResponse(
    (r) => r.url().includes('/account/wishlist') && r.request().method() === 'POST',
  );
  await add.click();
  expect((await posted).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Remove from wishlist' }).first()).toBeVisible();

  // A reload drops every in-memory value. Only the cookies can say who this is now.
  await page.reload();
  const mine = await serverWishlist(page);
  expect(mine.status, 'the server did not recognise the shopper after a reload').toBe(200);
  expect(mine.ids).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Remove from wishlist' }).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`${base()}/account`);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).not.toContain('/account');

  expect((await serverWishlist(page)).status, 'the session survived signing out').toBe(401);
  await page.goto(`${base()}/account`);
  await expect(page).toHaveURL(/\/account\/login/, { timeout: 30_000 });
  await page.goto(base());
  await expect(page.getByRole('button', { name: 'Add to wishlist' }).first()).toBeVisible({ timeout: 30_000 });
});

test('two shops in one browser keep separate shopper sessions', async ({ page }) => {
  // The point of the per-shop cookie scoping: signing in to one shop must not sign you in to, or out
  // of, another shop on the same host (every shop shares `localhost` here, as a custom domain would
  // not, but the cookie jar rules are the same).
  const other = await seedShop();
  const phone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const otherPhone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  for (const [slug, p] of [
    [seed.subdomain, phone],
    [other.subdomain, otherPhone],
  ] as const) {
    await page.goto(`${STOREFRONT_URL}/${slug}/account/register`);
    await register(page, `Shopper of ${slug}`, p);
  }

  const status = (slug: string) =>
    page.evaluate(async (s) => (await fetch(`/api/public/${s}/account/wishlist`, { credentials: 'include' })).status, slug);

  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/account`);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  expect(await status(seed.subdomain)).toBe(200);
  expect(await status(other.subdomain)).toBe(200);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).not.toContain('/account');
  expect(await status(seed.subdomain)).toBe(401);
  expect(await status(other.subdomain), 'signing out of one shop ended the other shop\'s session').toBe(200);
});
