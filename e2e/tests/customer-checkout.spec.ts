import { test, expect, type Page } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { readSeedState } from '../state';

// CheckoutSinglePage's Name/Phone fields render a <label> next to an
// <input> with no htmlFor/id pairing (checked via the failing getByLabel
// call this replaced) — a real accessibility gap in that form, out of
// scope to fix here, but getByLabel can't find them. This locates the
// field's own wrapper div by its exact label text instead.
function fieldByLabel(page: Page, label: string) {
  return page
    .locator('div')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('input');
}

test('customer browses, selects a variant, adds to cart, and checks out', async ({ page }) => {
  const seed = readSeedState();
  const variant = seed.variantProduct.variants[0];

  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}`);
  await page.getByRole('link', { name: new RegExp(seed.variantProduct.name) }).first().click();
  await page.waitForURL(new RegExp(`/products/${seed.variantProduct.slug}$`));

  await page.getByRole('button', { name: variant.label, exact: true }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();

  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/cart`);
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();

  // AddonPrompt is an async gate that only renders when the shop has other
  // isCheckoutAddon products not already in the cart — the seeded shop has
  // none, so it should resolve straight through to Checkout, but the gate
  // itself is async (see the exploration notes this spec was written from).
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 15_000 });

  const pickupButton = page.getByRole('button', { name: 'Pickup' });
  if (await pickupButton.isVisible()) await pickupButton.click();

  await fieldByLabel(page, 'Name').fill(seed.customerName);
  await fieldByLabel(page, 'Phone').fill(seed.customerPhone);
  await page.getByLabel('Cash on pickup').check();

  await page.getByRole('button', { name: 'Place order' }).click();

  await page.waitForURL(/\/orders\/\d+/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
});
