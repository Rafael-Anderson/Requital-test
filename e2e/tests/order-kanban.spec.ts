import { test, expect } from '@playwright/test';
import { ADMIN_URL } from '../urls';
import { readSeedState } from '../state';

test('merchant sees the new order on the kanban, advances its status, and opens the detail modal', async ({
  page,
}) => {
  const seed = readSeedState();

  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('Email').fill(seed.adminEmail);
  await page.getByLabel('Password').fill(seed.adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${ADMIN_URL}/`, { timeout: 10_000 });

  await page.goto(`${ADMIN_URL}/orders`);
  // div:has-text(...) without a scoping class matches every ANCESTOR div
  // too (the column, the board), not just the individual card — .first()
  // on that set returns the outermost match, not the card. Scoped to the
  // card's own distinguishing class (see admin/app/orders/page.tsx) plus
  // the exact order id, since another spec run in the same suite can place
  // a second order under the same seeded customer name.
  const card = page
    .locator('div.cursor-pointer', { hasText: seed.customerName })
    .filter({ hasText: `#${seed.seededOrderId}` });
  await expect(card).toBeVisible({ timeout: 15_000 });

  // Advance pending -> confirmed via the card's own button, not drag-and-drop
  // (this board is button-driven, not a DnD kanban — see admin/app/orders/page.tsx).
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText(`Order #${seed.seededOrderId} moved to confirmed`)).toBeVisible();

  // Card body opens the detail modal — the action-buttons row stops
  // propagation, so this has to click somewhere else in the card.
  await card.getByText(seed.customerName).click();
  await expect(page.getByText(`Order #${seed.seededOrderId}`).first()).toBeVisible();
});
