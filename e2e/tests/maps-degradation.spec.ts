import { test, expect, type Page } from '@playwright/test';
import { API_URL, STOREFRONT_URL } from '../urls';
import { api, sessionFromResponse } from '../seed';

// F9: Google Maps unavailable must never stop a shopper ordering. Two ways it
// fails in the wild, both driven here by routing maps.googleapis.com: the script
// cannot load at all (blocked), and the script loads but Google's bundle logs a
// RefererNotAllowedMapError. Either way the shopper sees OUR neutral message
// (never Google's text, never the key/referrer story), "Use my location" and the
// typed address keep working, and the order is placed on an outlet that has a
// delivery radius (which normally demands a pin).
const OUTLET = { lat: 25.2048, lng: 55.2708 };
// Nothing Nominatim can place: the server then accepts the typed address and
// flags it (an unreachable Nominatim in CI lands in the same branch).
const TYPED_ADDRESS = 'Zzqx Qwertyuiop Villa 99, Nowhereville Block 7';

let subdomain = '';
let slug = '';

test.beforeAll(async () => {
  test.setTimeout(150_000);
  const runId = `${Date.now()}`;
  subdomain = `pw-maps-${runId}`;
  const body = JSON.stringify({
    name: 'Playwright Maps Admin',
    email: `pw-maps-${runId}@test.com`,
    password: 'Password123!',
    shopName: `Playwright Maps Shop ${runId}`,
    subdomain,
    country: 'United Arab Emirates',
  });
  const post = () =>
    fetch(`${API_URL}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  let res = await post();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 61_000));
    res = await post();
  }
  if (!res.ok) throw new Error(`maps seed: signup -> ${res.status}: ${await res.text()}`);
  const session = sessionFromResponse(res);
  const signup = (await res.json()) as { devVerificationLink?: string };
  if (signup.devVerificationLink) {
    const token = new URL(signup.devVerificationLink).searchParams.get('token');
    await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  }
  const outlets = await api<{ id: number }[]>('/outlets', {}, session);
  const outletId = outlets[0].id;
  await api(
    `/outlets/${outletId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        active: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        latitude: OUTLET.lat,
        longitude: OUTLET.lng,
        deliveryRadiusKm: 10,
      }),
    },
    session,
  );
  await api('/shop', { method: 'PATCH', body: JSON.stringify({ defaultDeliveryFee: 15 }) }, session);
  const collection = await api<{ id: number }>(
    '/collections',
    { method: 'POST', body: JSON.stringify({ name: 'Flowers' }) },
    session,
  );
  const product = await api<{ id: number; slug: string }>(
    '/products',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Maps Rose',
        price: 100,
        thumbnail: 'https://placehold.co/400x400.png',
        sku: `PW-MAPS-${runId}`,
        status: 'Available',
        collectionIds: [collection.id],
        trackInventory: true,
      }),
    },
    session,
  );
  slug = product.slug;
  await api(
    '/products/stock/bulk-adjust',
    { method: 'PATCH', body: JSON.stringify({ outletId, adjustments: [{ productId: product.id, delta: 50 }] }) },
    session,
  );
  await api('/shop', { method: 'PATCH', body: JSON.stringify({ published: true }) }, session);
});

async function toCheckout(page: Page) {
  await page.goto(`${STOREFRONT_URL}/${subdomain}/products/${slug}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();
  await page.goto(`${STOREFRONT_URL}/${subdomain}/checkout`);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 15_000 });
}

async function fillTypedAddress(page: Page) {
  const field = (label: string) =>
    page.locator('div').filter({ hasText: new RegExp(`^${label}$`) }).locator('input');
  await field('Name').fill('Maps Tester');
  await field('Phone').fill('0501234567');
  await page.getByRole('button', { name: 'Cash on delivery' }).click();
  await page.locator('div').filter({ hasText: /^Full address$/ }).locator('textarea').fill(TYPED_ADDRESS);
  await page.locator('select').filter({ hasText: /Select/ }).first().selectOption({ label: 'Dubai' });
}

async function expectNeutralFallback(page: Page) {
  const box = page.getByTestId('map-unavailable');
  await expect(box).toBeVisible({ timeout: 20_000 });
  await expect(box).toContainText('Map unavailable. You can type your address below.');
  // Never Google's words and never the merchant's problem.
  await expect(box).not.toContainText(/google|api key|billing|referrer|referer/i);
  await expect(page.getByPlaceholder('Search an address')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Use my location/ })).toBeVisible();
}

async function placeAndExpectOrder(page: Page) {
  const created = page.waitForResponse(
    (r) => r.url().includes(`/public/${subdomain}/orders`) && r.request().method() === 'POST',
  );
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Place order' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  await page.waitForURL(/\/orders\/[0-9A-Fa-f]{32}$/, { timeout: 20_000 });
  const order = ((await response.json()) as { order: { addressUnverified?: boolean } }).order;
  // The server could not place the typed address on a map, so it flagged it.
  expect(order.addressUnverified).toBe(true);
}

test('Google Maps blocked outright: checkout is still completable with a typed address', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
  await toCheckout(page);
  await fillTypedAddress(page);
  await expectNeutralFallback(page);
  await placeAndExpectOrder(page);
  await context.close();
});

test('Google logging a RefererNotAllowedMapError: neutral message for the shopper, code beaconed once', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  // A script that loads fine and then does what Google's bundle does on a
  // referrer problem: one console.error line carrying the error name.
  await page.route('https://maps.googleapis.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'console.error("Google Maps JavaScript API error: RefererNotAllowedMapError\\nhttps://developers.google.com/maps/documentation/javascript/error-messages");',
    }),
  );
  const beacons: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes(`/public/${subdomain}/maps-error`)) beacons.push(req.postData() ?? '');
  });
  await toCheckout(page);
  await fillTypedAddress(page);
  await expectNeutralFallback(page);
  await expect(page.getByTestId('map-unavailable')).not.toContainText('RefererNotAllowedMapError');
  await expect.poll(() => beacons.length, { timeout: 10_000 }).toBe(1);
  expect(JSON.parse(beacons[0])).toEqual({ code: 'RefererNotAllowedMapError', host: new URL(STOREFRONT_URL).host });
  await placeAndExpectOrder(page);
  expect(beacons).toHaveLength(1);
  await context.close();
});
