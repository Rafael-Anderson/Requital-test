import { test, expect, type Page } from '@playwright/test';
import { API_URL, STOREFRONT_URL } from '../urls';
import { api, sessionFromResponse } from '../seed';

// The checkout summary must show the delivery fee and a total that INCLUDES it,
// and that total must be the one the order is created with. Unit tests cover the
// summary and the endpoint separately; only a browser walking address -> quote ->
// place order proves the figure on screen is the charged one.
//
// Seeds its own shop (delivery + a map-circle zone + 5% tax) so the shared
// fixture shop stays pickup-only for the other specs.
const OUTLET = { lat: 25.2048, lng: 55.2708 };
const PRICE = 100;
const ZONE_FEE = 30;
const EXPECTED_TOTAL = 135; // 100 + 5% tax + 30 delivery

async function seedDeliveryShop() {
  const runId = `${Date.now()}`;
  const subdomain = `pw-dq-${runId}`;
  const signupBody = JSON.stringify({
    name: 'Playwright Quote Admin',
    email: `pw-dq-${runId}@test.com`,
    password: 'Password123!',
    shopName: `Playwright Quote Shop ${runId}`,
    subdomain,
    country: 'United Arab Emirates',
  });
  const postSignup = () =>
    fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: signupBody,
    });
  let res = await postSignup();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 61_000));
    res = await postSignup();
  }
  if (!res.ok) throw new Error(`quote seed: signup -> ${res.status}: ${await res.text()}`);
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
  await api(
    '/shop',
    { method: 'PATCH', body: JSON.stringify({ taxRate: 5, taxInclusive: false, defaultDeliveryFee: 15 }) },
    session,
  );
  await api(
    `/outlets/${outletId}/delivery-zones`,
    {
      method: 'POST',
      body: JSON.stringify({ name: 'Marina', fee: ZONE_FEE, lat: OUTLET.lat, lng: OUTLET.lng, radiusKm: 5 }),
    },
    session,
  );
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
        name: 'Quote Rose',
        price: PRICE,
        thumbnail: 'https://placehold.co/400x400.png',
        sku: `PW-DQ-${runId}`,
        status: 'Available',
        collectionIds: [collection.id],
        trackInventory: true,
      }),
    },
    session,
  );
  await api(
    '/products/stock/bulk-adjust',
    { method: 'PATCH', body: JSON.stringify({ outletId, adjustments: [{ productId: product.id, delta: 50 }] }) },
    session,
  );
  await api('/shop', { method: 'PATCH', body: JSON.stringify({ published: true }) }, session);
  return { subdomain, slug: product.slug };
}

const amountIn = (text: string | null) => Number((text ?? '').replace(/[^0-9.]/g, ''));

async function fillContact(page: Page) {
  const field = (label: string) =>
    page.locator('div').filter({ hasText: new RegExp(`^${label}$`) }).locator('input');
  await field('Name').fill('Quote Tester');
  await field('Phone').fill('0501234567');
}

test('the delivery fee and the total shown at checkout are what the order is created with', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { subdomain, slug } = await seedDeliveryShop();
  const context = await browser.newContext({
    geolocation: { latitude: OUTLET.lat + 0.005, longitude: OUTLET.lng },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();

  // Cart page: delivery is said to be calculated later, never shown as 0.
  await page.goto(`${STOREFRONT_URL}/${subdomain}/products/${slug}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();
  await page.goto(`${STOREFRONT_URL}/${subdomain}/cart`);
  await expect(page.getByTestId('cart-delivery-row')).toContainText('Calculated at checkout');
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 15_000 });

  // No address yet: no fee and no total, only the honest placeholder.
  const deliveryRow = page.getByTestId('checkout-delivery-row');
  await expect(deliveryRow).toContainText('Calculated after you choose your address');
  await expect(page.getByTestId('checkout-total')).toHaveCount(0);

  await fillContact(page);
  await page.getByRole('button', { name: 'Cash on delivery' }).click();
  await page.locator('div').filter({ hasText: /^Full address$/ }).locator('textarea').fill('Marina Walk 1, Dubai');
  await page.locator('select').filter({ hasText: /Select/ }).first().selectOption({ label: 'Dubai' });
  await page.getByRole('button', { name: /Use my location/ }).click();

  // The quote arrives (debounced) and the total now includes delivery.
  await expect(deliveryRow).toContainText(String(ZONE_FEE), { timeout: 15_000 });
  const total = page.getByTestId('checkout-total');
  await expect(total).toBeVisible();
  const displayedTotal = amountIn(await total.textContent());
  expect(displayedTotal).toBe(EXPECTED_TOTAL);
  await expect(page.locator('body')).not.toContainText('before delivery');

  const created = page.waitForResponse(
    (r) => r.url().includes(`/public/${subdomain}/orders`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Place order' }).click();
  const body = (await (await created).json()) as { order: { total: string; deliveryFee: string } };
  expect(Number(body.order.total)).toBe(displayedTotal);
  expect(Number(body.order.deliveryFee)).toBe(ZONE_FEE);
  await page.waitForURL(/\/orders\/\d+/, { timeout: 20_000 });
  await context.close();
});

test('an address the outlet cannot deliver to shows the reason and blocks Place order', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { subdomain, slug } = await seedDeliveryShop();
  const context = await browser.newContext({
    // Abu Dhabi: far outside the outlet's 10km radius.
    geolocation: { latitude: 24.4539, longitude: 54.3773 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  await page.goto(`${STOREFRONT_URL}/${subdomain}/products/${slug}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();
  await page.goto(`${STOREFRONT_URL}/${subdomain}/checkout`);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 15_000 });

  await fillContact(page);
  await page.getByRole('button', { name: 'Cash on delivery' }).click();
  await page.locator('div').filter({ hasText: /^Full address$/ }).locator('textarea').fill('Far away 1');
  await page.locator('select').filter({ hasText: /Select/ }).first().selectOption({ label: 'Abu Dhabi' });
  await page.getByRole('button', { name: /Use my location/ }).click();

  await expect(page.getByTestId('checkout-delivery-reason')).toContainText('outside the outlet', {
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await context.close();
});
