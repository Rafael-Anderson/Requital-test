import { test, expect, type Page } from '@playwright/test';
import { API_URL, STOREFRONT_URL } from '../urls';
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
test.setTimeout(240_000); // includes a bounded wait for rate-limit headroom (ensureQuota)

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

// Every API call from this machine shares one per-IP window (100 a minute) with the earlier specs and
// the seeding, and a storefront page load is about ten calls. A 429 renders "This store is
// unavailable", which says nothing about cookies, so each test first waits (bounded) for enough headroom.
async function ensureQuota(page: Page, need = 80) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await page.request.get(`${API_URL}/public/${seed.subdomain}`);
    const remaining = Number(res.headers()['x-ratelimit-remaining']);
    const resetSeconds = Number(res.headers()['x-ratelimit-reset']);
    if (res.status() !== 429 && !(remaining < need)) return;
    await page.waitForTimeout(((Number.isFinite(resetSeconds) ? resetSeconds : 60) + 1) * 1000);
  }
}

const base = () => `${STOREFRONT_URL}/${seed.subdomain}`;

// A page that is navigating can leave an evaluate pending for a long time, so every ask is bounded.
function bounded<T>(work: Promise<T>, ms = 5_000): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('page busy')), ms))]);
}

// Click "Sign out" and wait for the logout request itself, so the checks that follow never race it.
async function signOut(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/logout') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
}

// What the server thinks of this browser, asked the way the page asks (relative /api, cookies attached
// by the browser). Never reads document.cookie: the cookies are httpOnly.
async function serverWishlist(page: Page): Promise<{ status: number; ids: number[] }> {
  return bounded(
    page.evaluate(async (slug) => {
      const res = await fetch(`/api/public/${slug}/account/wishlist`, { credentials: 'include' });
      const body = res.ok ? ((await res.json()) as unknown) : null;
      return { status: res.status, ids: Array.isArray(body) ? (body as number[]) : [] };
    }, seed.subdomain),
  );
}

test('a shopper stays signed in across a reload, keeps a server-side wishlist, and signing out ends the session', async ({ page }) => {
  const phone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  await ensureQuota(page);

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
  await signOut(page);
  // Where the page lands after signing out does not matter (the account page also bounces to login);
  // what matters is that the server no longer knows this browser. Polled: the page is navigating.
  await expect
    .poll(async () => (await serverWishlist(page)).status, { message: 'the session survived signing out', timeout: 15_000 })
    .toBe(401);
  // A signed-out visit to the account page is sent to the sign-in page.
  await page.goto(`${base()}/account`);
  await expect(page).toHaveURL(/\/account\/login/, { timeout: 30_000 });
});

test('two shops in one browser keep separate shopper sessions', async ({ page }) => {
  // The point of the per-shop cookie scoping: signing in to one shop must not sign you in to, or out
  // of, another shop on the same host (every shop shares `localhost` here, as a custom domain would
  // not, but the cookie jar rules are the same).
  const other = await seedShop();
  await ensureQuota(page);
  const phone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const otherPhone = `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  // Registered through the storefront's own /api proxy (same origin, same cookie jar as the page), not
  // through the form: this test is about the jar, and a page load costs about ten throttled API calls.
  for (const [slug, p] of [
    [seed.subdomain, phone],
    [other.subdomain, otherPhone],
  ] as const) {
    const res = await page.request.post(`${STOREFRONT_URL}/api/public/${slug}/auth/register`, {
      data: { name: `Shopper of ${slug}`, phone: p, password: 'Wishlist-Session-9x!' },
    });
    expect(res.status(), `register at ${slug}`).toBe(201);
  }

  const status = (slug: string) =>
    bounded(page.evaluate(async (s) => (await fetch(`/api/public/${s}/account/wishlist`, { credentials: 'include' })).status, slug));

  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/account`);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  expect(await status(seed.subdomain)).toBe(200);
  expect(await status(other.subdomain)).toBe(200);

  await signOut(page);
  await expect.poll(() => status(seed.subdomain), { timeout: 15_000 }).toBe(401);
  expect(await status(other.subdomain), 'signing out of one shop ended the other shop\'s session').toBe(200);
});
