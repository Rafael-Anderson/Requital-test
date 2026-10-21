import { hmacSha256Hex } from '../../src/channels/hmac';

// Locally generated, clearly fake Deliveroo fixtures. NOTHING here is a real
// credential or a real id; the signing secret is a throw-away test value.
export const FAKE_WEBHOOK_SECRET =
  'fake-deliveroo-webhook-secret-not-real-0001';
export const FAKE_CLIENT_ID = 'fake-client-id-not-real';
export const FAKE_CLIENT_SECRET = 'fake-client-secret-not-real-0002';

type Money = { fractional: number; currency_code: string };
export const aed = (n: number): Money => ({
  fractional: n,
  currency_code: 'AED',
});
export const kwd = (n: number): Money => ({
  fractional: n,
  currency_code: 'KWD',
});

let n = 0;
export function fakeOrder(over: Record<string, unknown> = {}) {
  n += 1;
  const placed = new Date().toISOString();
  return {
    id: `ae:00000000-0000-4000-8000-${String(n).padStart(12, '0')}${Math.floor(Math.random() * 1e6)}`,
    order_number: `FAKE-${n}`,
    display_id: `F${n}`,
    location_id: 'FAKE-LOC-1',
    brand_id: 'FAKE-BRAND-1',
    status: 'placed',
    status_log: [{ status: 'placed', at: placed }],
    fulfillment_type: 'deliveroo',
    asap: true,
    prepare_for: placed,
    start_preparing_at: placed,
    confirm_at: null,
    order_notes: null,
    subtotal: aed(5000),
    total_price: aed(5000),
    offer_discount: aed(0),
    cash_due: aed(0),
    items: [
      {
        pos_item_id: 'FAKE-ITEM-1',
        name: 'Fake roses',
        quantity: 2,
        unit_price: aed(2500),
        total_price: aed(2500),
        menu_unit_price: aed(2500),
        discount_amount: aed(0),
        modifiers: [],
      },
    ],
    customer: { first_name: 'Sam', contact_number: '+971500000000' },
    ...over,
  };
}

export function webhookBody(
  event: 'order.new' | 'order.status_update',
  order: Record<string, unknown>,
): string {
  return JSON.stringify({ event, body: { order } });
}

// HMAC-SHA256 hex over `<guid> + " " + <raw body>` (securing-webhooks.md).
export function signDeliveroo(
  secret: string,
  guid: string,
  raw: string | Buffer,
): string {
  return hmacSha256Hex(
    secret,
    Buffer.concat([Buffer.from(`${guid} `), Buffer.from(raw)]),
  );
}

export function deliverooHeaders(
  secret: string,
  guid: string,
  raw: string | Buffer,
) {
  return {
    'x-deliveroo-sequence-guid': guid,
    'x-deliveroo-hmac-sha256': signDeliveroo(secret, guid, raw),
    'content-type': 'application/json',
  };
}
