import { test, expect, type Page } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { api, seedShop, type SeedState } from '../seed';

// The Delivery / Pickup choice is decided per outlet (outlet.deliveryEnabled /
// pickupEnabled). With both on the shopper gets a toggle; with one on that option is
// applied with no control and only its own fields show; with neither, Place order is
// disabled with an explanation. Serial: one shop, the outlet's toggles are flipped
// through the real admin API between tests.
test.describe.configure({ mode: 'serial' });
// CI serves the storefront with `next dev`, which compiles each route on first visit.
test.setTimeout(120_000);

let seed: SeedState;
test.beforeAll(async () => {
  seed = await seedShop();
});

async function setOutlet(deliveryEnabled: boolean, pickupEnabled: boolean) {
  await api(
    `/outlets/${seed.outletId}`,
    { method: 'PATCH', body: JSON.stringify({ deliveryEnabled, pickupEnabled, deliveryRadiusKm: 10, latitude: 25.2048, longitude: 55.2708 }) },
    seed.session,
  );
}

function fieldByLabel(page: Page, label: string) {
  return page.locator('div').filter({ hasText: new RegExp(`^${label}$`) }).locator('input');
}

async function openCheckout(page: Page) {
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/products/${seed.simpleProduct.slug}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/cart`);
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 30_000 });
}

const deliveryButton = (page: Page) => page.getByRole('button', { name: 'Delivery', exact: true });
const pickupButton = (page: Page) => page.getByRole('button', { name: 'Pickup', exact: true });

test('delivery only: no toggle, address fields, no pickup details', async ({ page }) => {
  await setOutlet(true, false);
  await openCheckout(page);
  await expect(page.getByText('Delivery address')).toBeVisible();
  await expect(deliveryButton(page)).toHaveCount(0);
  await expect(pickupButton(page)).toHaveCount(0);
  await expect(page.getByText('Pickup from')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cash on delivery' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cash on pickup' })).toHaveCount(0);
});

test('pickup only: no toggle, pickup details, no address fields, and the order is placed', async ({ page }) => {
  await setOutlet(false, true);
  await openCheckout(page);
  await expect(page.getByText('Pickup from')).toBeVisible();
  await expect(page.getByText('Delivery address')).toHaveCount(0);
  await expect(deliveryButton(page)).toHaveCount(0);
  await expect(pickupButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cash on pickup' })).toBeVisible();

  await fieldByLabel(page, 'Name').fill(seed.customerName);
  await fieldByLabel(page, 'Phone').fill(seed.customerPhone);
  await page.getByRole('button', { name: 'Cash on pickup' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForURL(/\/orders\/\d+/, { timeout: 30_000 });
});

test('both: the toggle appears and switches the fields', async ({ page }) => {
  await setOutlet(true, true);
  await openCheckout(page);
  await expect(deliveryButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Delivery address')).toBeVisible();
  await pickupButton(page).click();
  await expect(page.getByText('Pickup from')).toBeVisible();
  await expect(page.getByText('Delivery address')).toHaveCount(0);
  await deliveryButton(page).click();
  await expect(page.getByText('Delivery address')).toBeVisible();
});

test('neither: a clear message and Place order is disabled', async ({ page }) => {
  await setOutlet(false, false);
  await openCheckout(page);
  await expect(page.getByText('Neither delivery nor pickup is available')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
});

test.afterAll(async () => {
  await setOutlet(false, true);
});
