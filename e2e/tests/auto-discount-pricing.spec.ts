import { test, expect } from '@playwright/test';
import { API_URL, STOREFRONT_URL } from '../urls';
import { api, sessionFromResponse, type AdminSession } from '../seed';

// DSC-1 regression, the assertion that did not exist anywhere until now: an
// auto-discounted price shown on the storefront must be the price the shopper
// is actually charged, all the way from the product card to the order total.
//
// The bug this guards shipped for real. `ProductGridSection`'s quick-add put
// the full catalog price into the cart while the server charged the
// auto-discounted one (ProductsService.resolveOrderItems), so the cart and
// checkout quoted a number the order never matched. Unit tests cover each half
// of that; only a browser walking the whole path proves the number never
// changes.
//
// Deliberately seeds its OWN shop rather than using the shared seed fixture:
// it has to publish a Sections theme (that is what renders the product grid at
// all) and attach a shop-wide auto-discount, neither of which should leak into
// the other four specs' shop.
interface DiscountShop {
  subdomain: string;
  session: AdminSession;
}

const CATALOG_PRICE = 50;
const DISCOUNT_PERCENT = 20;
const EXPECTED_PRICE = 40; // 50 - 20%

async function seedDiscountShop(): Promise<DiscountShop> {
  const runId = `${Date.now()}`;
  const subdomain = `pw-dsc-${runId}`;

  // POST /auth/signup is throttled at 5/min/IP. A full suite run already
  // signs up twice (global-setup and merchant-onboarding) before reaching
  // this spec, so a local re-run within the same window can push it over.
  // One wait-and-retry rather than a blanket limit increase: the throttle is
  // a real protection and the suite should live within it.
  const signupBody = JSON.stringify({
    name: 'Playwright Discount Admin',
    email: `pw-dsc-${runId}@test.com`,
    password: 'Password123!',
    shopName: `Playwright Discount Shop ${runId}`,
    subdomain,
  });
  const postSignup = () =>
    fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: signupBody,
    });
  let signupRes = await postSignup();
  if (signupRes.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    signupRes = await postSignup();
  }
  if (!signupRes.ok) {
    throw new Error(
      `auto-discount seed: POST /auth/signup -> ${signupRes.status}: ${await signupRes.text()}`,
    );
  }
  const session = sessionFromResponse(signupRes);
  const signup = (await signupRes.json()) as { devVerificationLink?: string };

  // Publishing needs a verified admin email, same dev-link flow seed.ts uses.
  if (signup.devVerificationLink) {
    const token = new URL(signup.devVerificationLink).searchParams.get('token');
    await api('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  const outlets = await api<{ id: number }[]>('/outlets', {}, session);
  const outletId = outlets[0].id;
  await api(
    `/outlets/${outletId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ pickupEnabled: true, active: true }),
    },
    session,
  );

  const collection = await api<{ id: number }>(
    '/collections',
    { method: 'POST', body: JSON.stringify({ name: 'Flowers' }) },
    session,
  );
  const product = await api<{ id: number }>(
    '/products',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Discounted Rose',
        price: CATALOG_PRICE,
        thumbnail: 'https://placehold.co/400x400.png',
        sku: `PW-DSC-${runId}`,
        status: 'Available',
        collectionIds: [collection.id],
        trackInventory: true,
      }),
    },
    session,
  );
  await api(
    '/products/stock/bulk-adjust',
    {
      method: 'PATCH',
      body: JSON.stringify({
        outletId,
        adjustments: [{ productId: product.id, delta: 100 }],
      }),
    },
    session,
  );

  // No code, scoped to this one product: "applies automatically to every
  // matching cart, no code needed".
  await api(
    '/shop/discounts',
    {
      method: 'POST',
      body: JSON.stringify({
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: DISCOUNT_PERCENT,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [product.id],
        active: true,
      }),
    },
    session,
  );

  // DEFAULT_THEME_CONFIG already contains a product_grid section with a
  // product_card block and globalSettings.productCards.quickAdd = true, so a
  // plain create + publish is enough; no config surgery needed.
  const theme = await api<{ id: number }>(
    '/themes',
    { method: 'POST', body: JSON.stringify({ name: 'Pricing test theme' }) },
    session,
  );
  await api(`/themes/${theme.id}/publish`, { method: 'POST' }, session);

  await api(
    '/shop',
    { method: 'PATCH', body: JSON.stringify({ published: true }) },
    session,
  );

  return { subdomain, session };
}

test('an auto-discounted price on the homepage grid is the price actually charged', async ({
  page,
}) => {
  // The config default is 30s. This spec seeds its own shop over ~8 API calls
  // first, and absorbs one 61s wait if it hits the signup throttle (see
  // seedDiscountShop), so it needs headroom the other specs do not.
  test.setTimeout(120_000);
  const { subdomain } = await seedDiscountShop();

  // --- 1. the card shows the discounted price, with the original struck
  await page.goto(`${STOREFRONT_URL}/${subdomain}`);
  const card = page
    .locator('.theme-product-card')
    .filter({ hasText: 'Discounted Rose' })
    .first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.locator('.text-sale-price')).toContainText(
    String(EXPECTED_PRICE),
  );
  await expect(card.locator('.line-through')).toContainText(
    String(CATALOG_PRICE),
  );

  // --- 2. quick-add puts that same number in the cart
  await card.hover();
  await card.getByRole('button', { name: /add/i }).first().click();

  await page.goto(`${STOREFRONT_URL}/${subdomain}/cart`);
  const cartBody = page.locator('body');
  await expect(cartBody).toContainText('Discounted Rose');
  await expect(cartBody).toContainText(String(EXPECTED_PRICE));
  // The pre-discount price must not appear anywhere in the cart, which is
  // exactly what the bug rendered.
  await expect(cartBody).not.toContainText(`${CATALOG_PRICE}.00`);

  // --- 3. checkout, and the order is charged that number
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({
    timeout: 15_000,
  });

  const pickupButton = page.getByRole('button', { name: 'Pickup', exact: true });
  if (await pickupButton.isVisible()) await pickupButton.click();

  // Same label-without-htmlFor workaround the checkout spec documents.
  const fieldByLabel = (label: string) =>
    page
      .locator('div')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('input');
  await fieldByLabel('Name').fill('Discount Tester');
  await fieldByLabel('Phone').fill('0501234567');
  await page.getByRole('button', { name: 'Cash on pickup' }).click();

  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForURL(/\/orders\/\d+/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();

  // No tax (a new shop's taxRate defaults to 0) and no delivery fee on a
  // pickup order, so the order total IS the discounted line price. If the
  // charge had been built from the catalog price this reads 50.
  await expect(page.locator('body')).toContainText(String(EXPECTED_PRICE));
  await expect(page.locator('body')).not.toContainText(`${CATALOG_PRICE}.00`);
});
