import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { ADMIN_URL, API_URL, STOREFRONT_URL } from '../urls';
import { api, seedShop, type SeedState } from '../seed';
import { startFakeStripe, type FakeSession } from '../fake-stripe';

// Custom orders end to end: staff build a draft in the admin, create the card
// payment link, the customer opens /pay/<token> on the storefront and presses
// Pay, the (fake) gateway sends them back, the gateway's signed webhook marks
// the order paid, and the order shows up for staff with its admin source.
//
// Stripe is a local fake (../fake-stripe.ts): the backend only talks to it when
// started with E2E_FAKE_STRIPE_URL (see .github/workflows/ci.yml). Without that
// the spec skips rather than calling the real Stripe API.
test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

const FAKE_ENABLED = !!process.env.E2E_FAKE_STRIPE_URL;

let shop: SeedState;
let fake: { server: Server; sessions: FakeSession[] } | null = null;

function webhookSecret(): string {
  if (process.env.E2E_STRIPE_WEBHOOK_SECRET) return process.env.E2E_STRIPE_WEBHOOK_SECRET;
  const env = readFileSync(resolve(__dirname, '../../backend/.env'), 'utf8');
  const m = /^STRIPE_WEBHOOK_SECRET=(.*)$/m.exec(env);
  if (!m) throw new Error('STRIPE_WEBHOOK_SECRET not found in backend/.env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

test.beforeAll(async () => {
  test.skip(!FAKE_ENABLED, 'needs the backend started with E2E_FAKE_STRIPE_URL');
  test.setTimeout(150_000);
  fake = await startFakeStripe();
  shop = await seedShop();
  // Stripe on the platform's own (dummy) key is the shop's card processor.
  await api('/payment-settings/stripe', { method: 'PATCH', body: JSON.stringify({ enabled: true }) }, shop.session);
});

test.afterAll(async () => {
  await new Promise<void>((r) => (fake ? fake.server.close(() => r()) : r()));
});

test('create draft, send the card link, customer pays through the gateway, order appears paid', async ({ page, context, browser }) => {
  // Reuse the seed's admin session instead of spending a login on the per-IP throttle.
  const cookies = shop.session!.cookie.split('; ').map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: API_URL };
  });
  await context.addCookies(cookies);

  // 1. Build the draft in the admin.
  await page.goto(`${ADMIN_URL}/orders/draft-orders/new`);
  await page.getByLabel('Name', { exact: true }).fill('Pay Link Customer');
  await page.getByLabel('Phone', { exact: true }).fill('0501239876');
  await page.getByRole('button', { name: 'Pickup', exact: true }).click();
  await page.getByLabel('Add a product').fill('Rose');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const bill = page.getByTestId('bill-split');
  await expect(bill).toContainText('Rose Bouquet', { timeout: 15_000 });
  await expect(bill).toContainText('50.00');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/orders\/draft-orders\/\d+$/, { timeout: 15_000 });

  // 2. Create the card payment link.
  await page.getByRole('button', { name: 'Card payment link' }).click();
  const linkField = page.getByLabel('Payment link');
  await expect(linkField).toBeVisible({ timeout: 15_000 });
  const link = await linkField.inputValue();
  const token = /\/pay\/([0-9A-Fa-f]{32})$/.exec(link)?.[1];
  expect(token, `pay link ${link}`).toBeTruthy();

  // 3. The customer (their own browser, without the staff session) opens the pay
  // page (path mode on localhost) and presses Pay.
  const staffPage = page;
  const customer = await browser.newContext();
  page = await customer.newPage();
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/pay/${token}`);
  await expect(page.getByTestId('pay-state-payable')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Rose Bouquet')).toBeVisible();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  // 4. The fake gateway: charged the draft's total, in minor units.
  await page.waitForURL(/127\.0\.0\.1:\d+\/gateway\//, { timeout: 30_000 });
  expect(fake!.sessions).toHaveLength(1);
  const session = fake!.sessions[0];
  expect(session.amount).toBe(5000);
  expect(session.currency).toBe('aed');

  // 5. The gateway's signed webhook marks the order paid (the return page never does).
  const event = JSON.stringify({
    id: `evt_fake_${Date.now()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: session.id,
        object: 'checkout.session',
        metadata: { orderId: String(session.orderId) },
        payment_intent: `pi_fake_${Date.now()}`,
        payment_status: 'paid',
        amount_total: session.amount,
        currency: session.currency,
      },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', webhookSecret()).update(`${t}.${event}`).digest('hex');
  const hook = await fetch(`${API_URL}/payments/webhook/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
    body: event,
  });
  expect(hook.status, await hook.text()).toBeLessThan(300);

  // 6. Back from the gateway: the confirmation page says paid because the server does.
  await page.getByRole('link', { name: 'Complete payment' }).click();
  await page.waitForURL(/\/orders\/[0-9A-Fa-f]{32}/, { timeout: 30_000 });
  await expect(page.getByText('Payment received')).toBeVisible({ timeout: 20_000 });

  // The pay link now reads paid, with the order number.
  await page.goto(`${STOREFRONT_URL}/${shop.subdomain}/pay/${token}`);
  await expect(page.getByTestId('pay-state-paid')).toBeVisible({ timeout: 20_000 });

  // 7. Staff see exactly one order, paid, created from the payment link.
  const orders = await api<{ data: { id: number; paymentStatus: string; adminSource: string | null; draftOrderId: number | null }[] }>(
    `/orders?search=${encodeURIComponent('Pay Link Customer')}`,
    {},
    shop.session,
  );
  const mine = orders.data.filter((o) => o.id === session.orderId);
  expect(mine).toHaveLength(1);
  expect(mine[0].paymentStatus).toBe('paid');
  expect(mine[0].adminSource).toBe('payment_link');
  await customer.close();
  await staffPage.goto(`${ADMIN_URL}/orders/${session.orderId}`);
  await expect(staffPage.getByText(/Created by .*Payment link/).first()).toBeVisible({ timeout: 15_000 });
});
