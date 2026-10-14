import { test, expect, type Page } from '@playwright/test';
import { API_URL, STOREFRONT_URL } from '../urls';
import { readSeedState } from '../state';
import { api, seedShop, type SeedState } from '../seed';

// The order confirmation page: reads the order by its tracking token, shows the
// per-shop number (never the global id), says "Payment received" only when the
// SERVER says paid (never from ?paid=1), and a sequential id in the URL opens
// nothing.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

// Own shop: the shared fixture's pending order is advanced by the kanban spec.
let shop: SeedState;
const DELIVERY_FEE = 12;
test.beforeAll(async () => {
  shop = await seedShop();
  // A delivery-capable outlet with a known default fee.
  await api(
    `/outlets/${shop.outletId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ deliveryEnabled: true, latitude: 25.2048, longitude: 55.2708, deliveryRadiusKm: 5 }),
    },
    shop.session,
  );
  await api('/shop', { method: 'PATCH', body: JSON.stringify({ defaultDeliveryFee: DELIVERY_FEE }) }, shop.session);
});

function fieldByLabel(page: Page, label: string) {
  return page
    .locator('div')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('input');
}

interface Lookup {
  id: number;
  shopOrderNumber: number;
  paymentStatus: string;
}
async function lookup(token: string): Promise<Lookup> {
  const res = await fetch(`${API_URL}/public/orders/lookup?token=${token}`);
  expect(res.ok).toBe(true);
  return (await res.json()) as Lookup;
}

async function placeApiOrder(over: Record<string, unknown>) {
  const r = await api<{ order: { id: number; trackingToken: string } }>(`/public/${shop.subdomain}/orders`, {
    method: 'POST',
    body: JSON.stringify({
      outletId: shop.outletId,
      customerName: 'Confirm Customer',
      customerPhone: '0501234567',
      customerAddress: '9 Palm Street',
      items: [{ productId: shop.simpleProduct.id, quantity: 1 }],
      ...over,
    }),
  });
  return r.order;
}

test('checkout lands on the confirmation page with the per-shop number, items and total', async ({ page }) => {
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/products/${shop.simpleProduct.slug}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();

  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/cart`);
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 15_000 });
  const pickupButton = page.getByRole('button', { name: 'Pickup', exact: true });
  if (await pickupButton.isVisible()) await pickupButton.click();
  await fieldByLabel(page, 'Name').fill('Confirm Customer');
  await fieldByLabel(page, 'Phone').fill('0501234567');
  await page.getByRole('button', { name: 'Cash on pickup' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();

  // The URL carries the tracking token, not the order id.
  await page.waitForURL(/\/orders\/[0-9A-Fa-f]{32}$/, { timeout: 30_000 });
  const token = page.url().split('/orders/')[1];
  const order = await lookup(token);

  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible({ timeout: 20_000 });
  // The seeded order is #1, so this one is #2; the global id is a different, larger number.
  expect(order.shopOrderNumber).toBe(2);
  expect(order.id).not.toBe(order.shopOrderNumber);
  await expect(page.getByText(`#${order.shopOrderNumber}`, { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(`#${order.id}`);

  await expect(page.getByText('Rose Bouquet')).toBeVisible();
  await expect(page.getByText('50.00').first()).toBeVisible();
  await expect(page.getByText('You will pay when you collect your order')).toBeVisible();
  await expect(page.getByText('Payment received')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Track order' })).toHaveAttribute('href', new RegExp(`/orders/track\\?token=${token}$`));
});

test('a forged ?paid=1 never turns an unpaid order into "Payment received"', async ({ page }) => {
  const o = await placeApiOrder({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' });
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/orders/${o.trackingToken}?paid=1`);
  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Payment received')).toHaveCount(0);
  expect((await lookup(o.trackingToken)).paymentStatus).toBe('unpaid');
});

test('a delivery order shows the address, the delivery fee and the total', async ({ page }) => {
  const o = await placeApiOrder({
    orderType: 'delivery',
    paymentMethod: 'cash_on_delivery',
    latitude: 25.2048,
    longitude: 55.2708,
  });
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/orders/${o.trackingToken}`);
  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('9 Palm Street')).toBeVisible();
  await expect(page.getByText('Delivery fee')).toBeVisible();
  await expect(page.getByText(`${DELIVERY_FEE}.00`).first()).toBeVisible();
  // 50 goods + 12 delivery, no tax on a new shop.
  await expect(page.getByText(`${50 + DELIVERY_FEE}.00`).first()).toBeVisible();
  await expect(page.getByText('You will pay when your order is delivered')).toBeVisible();
});

test('a sequential order id in the URL opens nothing and asks for no order data', async ({ page }) => {
  const o = await placeApiOrder({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' });
  const lookups: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/orders/lookup')) lookups.push(r.url());
  });
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/orders/${o.id}?paid=1`);
  await expect(page.getByText('We cannot open this order from here')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('Rose Bouquet');
  await expect(page.locator('body')).not.toContainText('Confirm Customer');
  await expect(page.getByText('Payment received')).toHaveCount(0);
  expect(lookups).toEqual([]);
  // The API itself answers an id the same way as any unknown token.
  const res = await fetch(`${API_URL}/public/orders/lookup?token=${o.id}`);
  expect(res.status).toBe(404);
});

test("another shop's storefront cannot show this order, even with the right token", async ({ page }) => {
  const o = await placeApiOrder({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' });
  const other = readSeedState(); // the shared fixture shop is a different tenant
  expect(other.subdomain).not.toBe(shop.subdomain);
  await page.goto(`${STOREFRONT_URL}/${other.subdomain}/orders/${o.trackingToken}`);
  await expect(page.getByText('We could not find that order')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('body')).not.toContainText('Rose Bouquet');
});

test('the page fits a phone-width viewport', async ({ page }) => {
  const o = await placeApiOrder({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/orders/${o.trackingToken}`);
  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible({ timeout: 20_000 });
  const m = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(m.scroll).toBeLessThanOrEqual(m.client + 1);
});
