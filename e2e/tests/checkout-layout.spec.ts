import { test, expect, type Page } from '@playwright/test';
import { STOREFRONT_URL } from '../urls';
import { readSeedState } from '../state';

// The checkout is ONE page: two columns from the lg breakpoint (1024px), one column
// below it; the summary card is sticky on desktop only. Measured in a real browser
// at the widths the layout is judged at, in both writing directions.
const seed = readSeedState();
// CI serves the storefront with `next dev`, which compiles the route on first visit.
test.setTimeout(90_000);

async function openCheckout(page: Page) {
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/products/${seed.simpleProduct.slug}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible();
  await page.goto(`${STOREFRONT_URL}/${seed.subdomain}/cart`);
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 30_000 });
}

const WIDTHS = [
  { width: 1440, height: 900, columns: 2 },
  { width: 1024, height: 768, columns: 2 },
  { width: 768, height: 1024, columns: 1 },
  { width: 390, height: 844, columns: 1 },
] as const;

for (const dir of ['ltr', 'rtl'] as const) {
  for (const vp of WIDTHS) {
    test(`${vp.width}px ${dir}: ${vp.columns} column(s), no overflow, nothing clipped`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openCheckout(page);
      if (dir === 'rtl') await page.evaluate(() => (document.documentElement.dir = 'rtl'));

      const details = page.getByTestId('checkout-details');
      const summary = page.getByTestId('checkout-summary-column');
      await expect(details).toBeVisible();
      await expect(summary).toBeVisible();
      const d = (await details.boundingBox())!;
      const s = (await summary.boundingBox())!;

      if (vp.columns === 2) {
        // side by side, tops aligned; the summary is on the END side of the details
        expect(Math.abs(d.y - s.y)).toBeLessThan(4);
        if (dir === 'ltr') expect(s.x).toBeGreaterThanOrEqual(d.x + d.width - 1);
        else expect(s.x + s.width).toBeLessThanOrEqual(d.x + 1);
      } else {
        // stacked: the summary follows the details, the same width
        expect(s.y).toBeGreaterThanOrEqual(d.y + d.height - 1);
        expect(Math.abs(s.width - d.width)).toBeLessThan(2);
      }

      // sticky on desktop only
      const position = await summary.evaluate((el) => getComputedStyle(el).position);
      expect(position).toBe(vp.columns === 2 ? 'sticky' : 'static');

      // no horizontal overflow, and neither column is clipped by the viewport edge
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
      for (const box of [d, s]) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      }
    });
  }
}

test('the summary column carries the items, the bill, payment and Place order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCheckout(page);
  const summary = page.getByTestId('checkout-summary-column');
  await expect(summary.getByTestId('checkout-items')).toBeVisible();
  await expect(summary.getByTestId('checkout-summary')).toBeVisible();
  await expect(summary.getByRole('button', { name: 'Cash on pickup' })).toBeVisible();
  await expect(summary.getByRole('button', { name: 'Place order' })).toBeVisible();
  // and the contact fields are on the other side
  await expect(page.getByTestId('checkout-details').locator('#checkout-name')).toBeVisible();
});

test('Place order stays disabled until the required fields are valid, then places the order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCheckout(page);
  const place = page.getByRole('button', { name: 'Place order' });
  await expect(place).toBeDisabled();
  await expect(page.getByTestId('checkout-missing')).toBeVisible();

  await page.locator('#checkout-name').fill(seed.customerName);
  await expect(place).toBeDisabled();
  await page.locator('#checkout-phone').fill(seed.customerPhone);
  await page.getByRole('button', { name: 'Cash on pickup' }).click();
  await expect(place).toBeEnabled();
  await expect(page.getByTestId('checkout-missing')).toHaveCount(0);

  await place.click();
  await page.waitForURL(/\/orders\/[0-9A-Fa-f]{32}$/, { timeout: 30_000 });
});

test('on a phone the total is repeated right above Place order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCheckout(page);
  const compact = page.getByTestId('checkout-total-compact');
  await expect(compact).toBeVisible();
  const c = (await compact.boundingBox())!;
  const b = (await page.getByRole('button', { name: 'Place order' }).boundingBox())!;
  expect(c.y).toBeLessThan(b.y);
  expect(b.y - (c.y + c.height)).toBeLessThan(120);
  // and it is not drawn on desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(compact).toBeHidden();
});
