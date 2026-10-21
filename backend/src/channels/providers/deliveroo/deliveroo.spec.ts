import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_WEBHOOK_SECRET,
  aed,
  deliverooHeaders,
  fakeOrder,
  kwd,
  webhookBody,
} from '../../../../test/helpers/deliveroo-fixtures';
import type { BoundChannelConnection } from '../../channel.types';
import {
  DELIVEROO_SANDBOX,
  DeliverooApiClient,
  DeliverooCallError,
  assertSandboxUrl,
  resolveCredentials,
} from './deliveroo-api.client';
import {
  DeliverooChannelProvider,
  MAX_EVENT_AGE_MS,
} from './deliveroo-channel.provider';
import { locationIdOf, mapDeliverooOrder } from './deliveroo-order.mapper';

type Call = { url: string; method: string; body: unknown; auth: string | null };

function fakeHttp(
  handler: (c: Call) => { status: number; json?: unknown; retryAfter?: number },
) {
  const calls: Call[] = [];
  const fn = jest.fn((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body:
        typeof init?.body === 'string' && init.body.startsWith('{')
          ? JSON.parse(init.body)
          : init?.body,
      auth: headers.Authorization ?? null,
    };
    calls.push(call);
    const r = url.includes('/oauth2/token')
      ? { status: 200, json: { access_token: 'tok-fake', expires_in: 300 } }
      : handler(call);
    return Promise.resolve(
      new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), {
        status: r.status,
        headers:
          'retryAfter' in r && r.retryAfter
            ? { 'retry-after': String(r.retryAfter) }
            : {},
      }),
    );
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const conn = (
  over: Partial<BoundChannelConnection> = {},
): BoundChannelConnection => ({
  id: 7,
  shopId: 1,
  outletId: 1,
  provider: 'deliveroo',
  externalLocationId: 'FAKE-LOC-1',
  externalBrandId: 'FAKE-BRAND-1',
  externalSiteId: 'FAKE-SITE-1',
  credentials: { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET },
  webhookSecret: null,
  ...over,
});

describe('Deliveroo webhook verification', () => {
  const p = new DeliverooChannelProvider();
  const raw = Buffer.from(webhookBody('order.new', fakeOrder()));
  const good = () => deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-0001', raw);
  const verify = (
    headers: Record<string, string>,
    rawBody = raw,
    secrets = [FAKE_WEBHOOK_SECRET],
  ) => p.verifyWebhook({ rawBody, headers, secrets });

  it('accepts a correctly signed raw body and builds a body-bound event id', () => {
    const r = verify(good());
    expect(r.valid).toBe(true);
    expect(r.eventId).toMatch(/^g-0001:[0-9a-f]{32}$/);
  });
  it('rejects a wrong secret, a tampered body, a missing or malformed signature or guid', () => {
    expect(verify(good(), raw, ['another-secret']).valid).toBe(false);
    expect(verify(good(), Buffer.concat([raw, Buffer.from(' ')])).valid).toBe(
      false,
    );
    expect(verify({ ...good(), 'x-deliveroo-hmac-sha256': 'abc' }).valid).toBe(
      false,
    );
    const noSig: Record<string, string> = { ...good() };
    delete noSig['x-deliveroo-hmac-sha256'];
    expect(verify(noSig).valid).toBe(false);
    const noGuid: Record<string, string> = { ...good() };
    delete noGuid['x-deliveroo-sequence-guid'];
    expect(verify(noGuid).valid).toBe(false);
  });
  it('rejects a guid that contains whitespace (it would let one signed pair pose as another)', () => {
    // Signed over "a b" + " " + body; presented as guid "a b" it must not verify.
    const h = deliverooHeaders(FAKE_WEBHOOK_SECRET, 'a b', raw);
    expect(verify(h).valid).toBe(false);
  });
  it('signs the raw bytes, not re-serialised JSON', () => {
    const spaced = Buffer.from(` ${raw.toString('utf8').replace(',', ' , ')}`);
    const h = deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-1', raw);
    expect(verify(h, spaced).valid).toBe(false);
  });
  it('accepts when any one candidate secret matches (connection or platform)', () => {
    expect(verify(good(), raw, ['nope', FAKE_WEBHOOK_SECRET, '']).valid).toBe(
      true,
    );
  });
  it('rejects a delivery whose newest signed status time is stale or in the future', () => {
    const old = new Date(Date.now() - MAX_EVENT_AGE_MS - 60_000).toISOString();
    const stale = Buffer.from(
      webhookBody(
        'order.status_update',
        fakeOrder({ status_log: [{ status: 'placed', at: old }] }),
      ),
    );
    expect(
      verify(deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-2', stale), stale).valid,
    ).toBe(false);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const fut = Buffer.from(
      webhookBody(
        'order.new',
        fakeOrder({ status_log: [{ status: 'placed', at: future }] }),
      ),
    );
    expect(
      verify(deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-3', fut), fut).valid,
    ).toBe(false);
  });
  it('a different body with the same guid is a different event id', () => {
    const raw2 = Buffer.from(webhookBody('order.new', fakeOrder()));
    const a = verify(deliverooHeaders(FAKE_WEBHOOK_SECRET, 'same', raw), raw);
    const b = verify(deliverooHeaders(FAKE_WEBHOOK_SECRET, 'same', raw2), raw2);
    expect(a.eventId).not.toBe(b.eventId);
  });
});

describe('Deliveroo review fixes', () => {
  const p = new DeliverooChannelProvider();
  const raw = (order: Record<string, unknown>) =>
    Buffer.from(webhookBody('order.new', order));
  const verify = (b: Buffer) =>
    p.verifyWebhook({
      rawBody: b,
      headers: deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-r', b),
      secrets: [FAKE_WEBHOOK_SECRET],
    });

  it('L3 a signed body without a parseable status_log is refused', () => {
    expect(verify(raw(fakeOrder())).valid).toBe(true);
    expect(verify(raw({ ...fakeOrder(), status_log: undefined })).valid).toBe(
      false,
    );
    expect(verify(raw(fakeOrder({ status_log: [] }))).valid).toBe(false);
    expect(
      verify(raw(fakeOrder({ status_log: [{ status: 'placed', at: 'x' }] })))
        .valid,
    ).toBe(false);
    expect(verify(Buffer.from('not json')).valid).toBe(false);
  });
  it('M2 declares its display name and exact credential keys', () => {
    expect(p.displayName).toBe('Deliveroo');
    expect(p.credentialFields).toEqual([
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientSecret', label: 'Client secret' },
    ]);
  });
  it('M2 removing a declared credential key makes testConnection fail without any call', async () => {
    const q = new DeliverooChannelProvider();
    const http = fakeHttp(() => ({ status: 200, json: { orders: [] } }));
    q.api.fetchImpl = http.fn;
    const full = conn({ externalBrandId: null });
    expect((await q.testConnection(full)).ok).toBe(true);
    for (const key of p.credentialFields.map((f) => f.key)) {
      const creds = { ...full.credentials! };
      delete creds[key];
      http.calls.length = 0;
      const r = await q.testConnection({ ...full, credentials: creds });
      expect(r.ok).toBe(false);
      expect(r.message).toContain('Client ID and a Client secret');
      expect(http.calls).toHaveLength(0);
    }
  });
  it('M1 the platform webhook secret is off in production unless explicitly allowed', () => {
    const keys = [
      'NODE_ENV',
      'DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET',
      'DELIVEROO_SANDBOX_WEBHOOK_SECRET',
    ] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.DELIVEROO_SANDBOX_WEBHOOK_SECRET =
        'fake-platform-secret-unit';
      process.env.NODE_ENV = 'test';
      expect(p.platformWebhookSecrets()).toEqual(['fake-platform-secret-unit']);
      process.env.NODE_ENV = 'production';
      delete process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET;
      expect(p.platformWebhookSecrets()).toEqual([]);
      process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET = '1';
      expect(p.platformWebhookSecrets()).toEqual(['fake-platform-secret-unit']);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
  it('M1 the platform sandbox credentials never apply in production and never complete a half-filled pair', () => {
    const keys = [
      'NODE_ENV',
      'DELIVEROO_SANDBOX_CLIENT_ID',
      'DELIVEROO_SANDBOX_CLIENT_SECRET',
    ] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.DELIVEROO_SANDBOX_CLIENT_ID = 'platform-fake-id';
      process.env.DELIVEROO_SANDBOX_CLIENT_SECRET = 'platform-fake-secret';
      process.env.NODE_ENV = 'test';
      expect(resolveCredentials(null)).toEqual({
        clientId: 'platform-fake-id',
        clientSecret: 'platform-fake-secret',
      });
      expect(resolveCredentials({ clientId: 'own-id' })).toBeNull();
      expect(resolveCredentials({ clientSecret: 'own-secret' })).toBeNull();
      expect(
        resolveCredentials({ clientId: 'own-id', clientSecret: 'own-secret' }),
      ).toEqual({ clientId: 'own-id', clientSecret: 'own-secret' });
      process.env.NODE_ENV = 'production';
      expect(resolveCredentials(null)).toBeNull();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
  it('L1 ids that could change a URL path are refused, and never reach the network', async () => {
    const q = new DeliverooChannelProvider();
    const http = fakeHttp(() => ({ status: 200 }));
    q.api.fetchImpl = http.fn;
    for (const bad of ['..', '.', '.x', '../x', 'a/b']) {
      expect(
        (await q.setItemAvailability(conn({ externalBrandId: bad }), [])).ok,
      ).toBe(false);
      expect(
        (await q.setItemAvailability(conn({ externalSiteId: bad }), [])).ok,
      ).toBe(false);
      expect((await q.acceptOrder(conn(), bad)).ok).toBe(false);
      await expect(
        q.listOpenOrders(conn({ externalLocationId: bad })),
      ).rejects.toBeInstanceOf(DeliverooCallError);
    }
    expect(
      http.calls.filter((c) => !c.url.includes('/oauth2/token')),
    ).toHaveLength(0);
    const hd = deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-1', Buffer.from('{}'));
    const body = Buffer.from(
      JSON.stringify({ body: { order: { location_id: '..' } } }),
    );
    expect(q.extractRoutingKey(body, hd)).toBeNull();
  });
});

describe('Deliveroo routing key', () => {
  const p = new DeliverooChannelProvider();
  const h = (raw: Buffer) => deliverooHeaders(FAKE_WEBHOOK_SECRET, 'g-1', raw);
  it('is body.order.location_id and nothing else', () => {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'order.new',
        location_id: 'WRONG-top',
        body: {
          location_id: 'WRONG-body',
          order: {
            location_id: 'FAKE-LOC-1',
            site_id: 'WRONG-site',
            brand_id: 'WRONG-brand',
          },
        },
      }),
    );
    expect(p.extractRoutingKey(raw, h(raw))).toBe('FAKE-LOC-1');
    expect(locationIdOf(JSON.parse(raw.toString()))).toBe('FAKE-LOC-1');
  });
  it('refuses before any lookup when the headers are missing or malformed', () => {
    const raw = Buffer.from(webhookBody('order.new', fakeOrder()));
    expect(p.extractRoutingKey(raw, {})).toBeNull();
    expect(
      p.extractRoutingKey(raw, {
        ...h(raw),
        'x-deliveroo-sequence-guid': 'has space',
      }),
    ).toBeNull();
    expect(
      p.extractRoutingKey(raw, { ...h(raw), 'x-deliveroo-hmac-sha256': 'zz' }),
    ).toBeNull();
  });
  it('is null for garbage, a missing or an odd location id', () => {
    for (const body of [
      'not json',
      '{}',
      JSON.stringify({ body: { order: {} } }),
      JSON.stringify({ body: { order: { location_id: 'a b' } } }),
      JSON.stringify({ body: { order: { location_id: 'x'.repeat(192) } } }),
    ]) {
      const raw = Buffer.from(body);
      expect(p.extractRoutingKey(raw, h(raw))).toBeNull();
    }
  });
});

describe('Deliveroo order mapping', () => {
  it('maps a placed ASAP order: ids, money, status, no tax or commission', () => {
    const o = mapDeliverooOrder(
      fakeOrder({ subtotal: aed(5000), total_price: aed(5000) }),
    );
    expect(o.currency).toBe('AED');
    expect(o.lines[0]).toMatchObject({
      externalItemId: 'FAKE-ITEM-1',
      quantity: 2,
      unitPriceMinor: 2500,
      taxMinor: null,
    });
    expect(o.totals).toMatchObject({
      totalMinor: 5000,
      taxMinor: null,
      commissionMinor: null,
      deliveryFeeMinor: null,
      cashDueMinor: 0,
    });
    expect(o.handover).toBe('marketplace_courier');
    expect(o.externalStatus).toBe('placed');
  });
  it('derives acceptBy from the placed time and the market window (7 min UAE and Kuwait, 10 elsewhere, unknown shorter)', () => {
    const at = '2026-10-21T10:00:00.000Z';
    const mk = (id: string) =>
      mapDeliverooOrder(
        fakeOrder({ id, status_log: [{ status: 'placed', at }] }),
      ).acceptBy;
    expect(mk('ae:abc')).toBe('2026-10-21T10:07:00.000Z');
    expect(mk('kw:abc')).toBe('2026-10-21T10:07:00.000Z');
    expect(mk('gb:abc')).toBe('2026-10-21T10:10:00.000Z');
    expect(mk('weird-id')).toBe('2026-10-21T10:07:00.000Z');
  });
  it('gives a scheduled order no invented acceptance deadline and a scheduledFor', () => {
    const o = mapDeliverooOrder(
      fakeOrder({ asap: false, prepare_for: '2026-10-22T09:00:00Z' }),
    );
    expect(o.acceptBy).toBeNull();
    expect(o.scheduledFor).toBe('2026-10-22T09:00:00Z');
  });
  it('maps every fulfillment type to a handover', () => {
    const h = (t: string) =>
      mapDeliverooOrder(fakeOrder({ fulfillment_type: t })).handover;
    expect(h('deliveroo')).toBe('marketplace_courier');
    expect(h('restaurant')).toBe('merchant_delivery');
    expect(h('customer')).toBe('customer_pickup');
    expect(h('table_service')).toBe('customer_pickup');
    expect(h('autonomous')).toBe('marketplace_courier');
    expect(h('catering')).toBe('marketplace_courier');
  });
  it('keeps KWD three decimals exactly and ignores a figure in another currency', () => {
    const o = mapDeliverooOrder(
      fakeOrder({
        subtotal: kwd(10505),
        total_price: kwd(10505),
        offer_discount: aed(100),
        items: [
          {
            pos_item_id: 'K',
            name: 'K',
            quantity: 1,
            unit_price: kwd(10505),
            total_price: kwd(10505),
          },
        ],
      }),
    );
    expect(o.currency).toBe('KWD');
    expect(o.lines[0].unitPriceMinor).toBe(10505);
    expect(o.totals.discountMinor).toBeNull();
  });
  it('folds nested modifiers into the unit price and the note, and reads total_price as per unit', () => {
    const o = mapDeliverooOrder(
      fakeOrder({
        total_price: aed(6000),
        items: [
          {
            pos_item_id: 'B',
            name: 'Bouquet',
            quantity: 2,
            unit_price: aed(2000),
            total_price: aed(3000),
            modifiers: [
              {
                name: 'Vase',
                quantity: 1,
                unit_price: aed(700),
                modifiers: [
                  { name: 'Ribbon', quantity: 2, unit_price: aed(150) },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(o.lines[0].unitPriceMinor).toBe(3000);
    expect(o.lines[0].note).toBe('+ Vase, Ribbon x2');
  });
  it('recognises the test-order shape (total_price already the line total) and uses the computed unit price', () => {
    const o = mapDeliverooOrder(
      fakeOrder({
        items: [
          {
            pos_item_id: 'T',
            name: 'T',
            quantity: 3,
            unit_price: aed(1000),
            total_price: aed(3000),
            modifiers: [],
          },
        ],
        total_price: aed(3000),
      }),
    );
    expect(o.lines[0].unitPriceMinor).toBe(1000);
  });
  it('gives an item with no pos_item_id a stable synthetic id (so it lands in needs_mapping, never a product)', () => {
    const a = mapDeliverooOrder(
      fakeOrder({
        items: [
          {
            pos_item_id: null,
            name: 'Mystery',
            quantity: 1,
            unit_price: aed(1),
            total_price: aed(1),
          },
        ],
      }),
    );
    const b = mapDeliverooOrder(
      fakeOrder({
        items: [
          {
            name: ' mystery ',
            quantity: 1,
            unit_price: aed(1),
            total_price: aed(1),
          },
        ],
      }),
    );
    expect(a.lines[0].externalItemId).toMatch(/^name:[0-9a-f]{24}$/);
    expect(a.lines[0].externalItemId).toBe(b.lines[0].externalItemId);
  });
  it('captures cash due, the restaurant delivery fee and address, remake and variable weight notes', () => {
    const o = mapDeliverooOrder(
      fakeOrder({
        fulfillment_type: 'restaurant',
        cash_due: aed(5000),
        remake_details: { parent_order_id: 'ae:parent', fault: 'restaurant' },
        delivery: {
          line1: 'Street 1',
          city: 'Dubai',
          customer_name: 'Sam K',
          delivery_fee: aed(700),
          note: 'Ring twice',
        },
        items: [
          {
            pos_item_id: 'W',
            name: 'Fruit',
            quantity: 1,
            unit_price: aed(100),
            total_price: aed(100),
            variable_weight: {
              is_variable_weight: true,
              final_weight: { value: 1.2, unit_of_measure: 'kg' },
            },
          },
        ],
      }),
    );
    expect(o.totals.cashDueMinor).toBe(5000);
    expect(o.totals.deliveryFeeMinor).toBe(700);
    expect(o.customer.address).toBe('Street 1, Dubai');
    expect(o.customer.notes).toContain('Remake of order ae:parent');
    expect(o.lines[0].note).toBe('Weight 1.2 kg');
  });
  it('refuses an order with no total, no id or no valid quantity', () => {
    expect(() => mapDeliverooOrder(fakeOrder({ total_price: null }))).toThrow();
    expect(() => mapDeliverooOrder(fakeOrder({ id: '' }))).toThrow();
    expect(() =>
      mapDeliverooOrder(
        fakeOrder({ items: [{ pos_item_id: 'x', name: 'x', quantity: 0 }] }),
      ),
    ).toThrow();
  });
});

describe('Deliveroo parseEvent', () => {
  const p = new DeliverooChannelProvider();
  it('order.new -> order_new; status_update carries the order when it maps', () => {
    const o = fakeOrder();
    expect(p.parseEvent(JSON.parse(webhookBody('order.new', o))).kind).toBe(
      'order_new',
    );
    const ev = p.parseEvent(
      JSON.parse(
        webhookBody('order.status_update', { ...o, status: 'canceled' }),
      ),
    );
    expect(ev).toMatchObject({
      kind: 'order_status',
      status: 'cancelled',
      externalStatus: 'canceled',
    });
    expect((ev as { order?: unknown }).order).toBeDefined();
  });
  it('a cancellation whose body does not map still applies the status', () => {
    const o = fakeOrder({ status: 'canceled', items: [] });
    const ev = p.parseEvent(JSON.parse(webhookBody('order.status_update', o)));
    expect(ev).toMatchObject({ kind: 'order_status', status: 'cancelled' });
    expect((ev as { order?: unknown }).order).toBeUndefined();
  });
  it('an order.new that is already accepted (tablet flow) becomes an accepted status that creates the order', () => {
    const ev = p.parseEvent(
      JSON.parse(webhookBody('order.new', fakeOrder({ status: 'accepted' }))),
    );
    expect(ev).toMatchObject({ kind: 'order_status', status: 'accepted' });
    expect((ev as { order?: unknown }).order).toBeDefined();
  });
  it('maps confirmed to accepted and pending to other; ignores unknown events', () => {
    const s = (st: string) =>
      p.parseEvent(
        JSON.parse(
          webhookBody('order.status_update', fakeOrder({ status: st })),
        ),
      ) as { status: string; externalStatus: string };
    expect(s('confirmed')).toMatchObject({
      status: 'accepted',
      externalStatus: 'confirmed',
    });
    expect(s('pending').status).toBe('other');
    expect(p.parseEvent({ event: 'rider.assigned', body: {} }).kind).toBe(
      'ignored',
    );
    expect(() => p.parseEvent(null)).toThrow();
    expect(() => p.parseEvent({ event: 'order.new', body: {} })).toThrow();
  });
});

describe('Deliveroo API client', () => {
  const creds = { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET };

  it('only ever calls the sandbox hosts over https', () => {
    expect(() =>
      assertSandboxUrl(`${DELIVEROO_SANDBOX.orderBase}/v1/x`),
    ).not.toThrow();
    for (const bad of [
      'https://api.developers.deliveroo.com/order/v1/x',
      'https://auth.developers.deliveroo.com/oauth2/token',
      'http://api-sandbox.developers.deliveroo.com/order',
      'https://api-sandbox.developers.deliveroo.com.evil.test/order',
      'https://api-sandbox.developers.deliveroo.com:8443/order',
      'https://evil.test/',
    ]) {
      expect(() => assertSandboxUrl(bad)).toThrow(DeliverooCallError);
    }
  });
  it('caches the token until shortly before expiry, then refreshes (token expiry and refresh)', async () => {
    const http = fakeHttp(() => ({ status: 200, json: {} }));
    const c = new DeliverooApiClient();
    c.fetchImpl = http.fn;
    let now = 1_000_000;
    c.now = () => now;
    const calls = () =>
      http.calls.filter((x) => x.url.includes('/oauth2/token')).length;
    await c.request(creds, 'GET', `${DELIVEROO_SANDBOX.orderBase}/v2/orders/a`);
    await c.request(creds, 'GET', `${DELIVEROO_SANDBOX.orderBase}/v2/orders/b`);
    expect(calls()).toBe(1);
    now += 280_000; // inside the 30 s safety margin of a 300 s token
    await c.request(creds, 'GET', `${DELIVEROO_SANDBOX.orderBase}/v2/orders/c`);
    expect(calls()).toBe(2);
  });
  it('shares one token request between concurrent callers', async () => {
    const http = fakeHttp(() => ({ status: 200 }));
    const c = new DeliverooApiClient();
    c.fetchImpl = http.fn;
    await Promise.all(
      [1, 2, 3, 4].map((i) =>
        c.request(
          creds,
          'GET',
          `${DELIVEROO_SANDBOX.orderBase}/v2/orders/${i}`,
        ),
      ),
    );
    expect(
      http.calls.filter((x) => x.url.includes('/oauth2/token')),
    ).toHaveLength(1);
  });
  it('drops the token and retries once on a 401', async () => {
    let n = 0;
    const http = fakeHttp(() => ({ status: ++n === 1 ? 401 : 200 }));
    const c = new DeliverooApiClient();
    c.fetchImpl = http.fn;
    const r = await c.request(
      creds,
      'GET',
      `${DELIVEROO_SANDBOX.orderBase}/v2/orders/a`,
    );
    expect(r.status).toBe(200);
    expect(
      http.calls.filter((x) => x.url.includes('/oauth2/token')),
    ).toHaveLength(2);
  });
  it('never puts a credential or token in an error message', async () => {
    const c = new DeliverooApiClient();
    c.fetchImpl = () =>
      Promise.reject(new Error(`boom ${FAKE_CLIENT_SECRET} tok-fake`));
    const err = await c
      .request(creds, 'GET', `${DELIVEROO_SANDBOX.orderBase}/v2/orders/a`)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(DeliverooCallError);
    expect((err as Error).message).not.toContain(FAKE_CLIENT_SECRET);
    expect((err as Error).message).not.toContain('tok-fake');
    const bad = new DeliverooApiClient();
    bad.fetchImpl = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: FAKE_CLIENT_SECRET }), {
          status: 401,
        }),
      );
    const e2 = await bad.token(creds).catch((e: Error) => e);
    expect((e2 as Error).message).not.toContain(FAKE_CLIENT_SECRET);
  });
});

describe('Deliveroo outbound calls', () => {
  let p: DeliverooChannelProvider;
  const setup = (h: Parameters<typeof fakeHttp>[0]) => {
    p = new DeliverooChannelProvider();
    const http = fakeHttp(h);
    p.api.fetchImpl = http.fn;
    p.sleep = jest.fn(() => Promise.resolve());
    return http;
  };
  const orderUrl = (id: string) =>
    `${DELIVEROO_SANDBOX.orderBase}/v1/orders/${id}`;

  it('accept -> PATCH {status: accepted}, 204 is success', async () => {
    const http = setup(() => ({ status: 204 }));
    expect(await p.acceptOrder(conn(), 'ae:abc')).toEqual({ ok: true });
    const c = http.calls.find((x) => x.method === 'PATCH')!;
    expect(c.url).toBe(orderUrl('ae:abc'));
    expect(c.body).toEqual({ status: 'accepted' });
    expect(c.auth).toBe('Bearer tok-fake');
  });
  it('reject -> each documented reason is sent as is; anything else is other with capped notes', async () => {
    const http = setup(() => ({ status: 204 }));
    for (const r of [
      'closing_early',
      'busy',
      'ingredient_unavailable',
      'other',
    ])
      expect((await p.rejectOrder(conn(), 'ae:r', r)).ok).toBe(true);
    await p.rejectOrder(conn(), 'ae:r', 'x'.repeat(500));
    const bodies = http.calls
      .filter((x) => x.method === 'PATCH')
      .map((x) => x.body as { reject_reason: string; notes?: string });
    expect(bodies.slice(0, 4).map((b) => b.reject_reason)).toEqual([
      'closing_early',
      'busy',
      'ingredient_unavailable',
      'other',
    ]);
    expect(bodies[4].reject_reason).toBe('other');
    expect(bodies[4].notes).toHaveLength(200);
  });
  it('409 invalid_status_transition is success only when the order is already in the wanted state', async () => {
    const http = setup((c) =>
      c.method === 'PATCH'
        ? {
            status: 409,
            json: { error: { code: 'invalid_status_transition' } },
          }
        : { status: 200, json: { status: 'accepted' } },
    );
    expect((await p.acceptOrder(conn(), 'ae:done')).ok).toBe(true);
    expect(
      http.calls.some(
        (x) => x.method === 'GET' && x.url.endsWith('/v2/orders/ae:done'),
      ),
    ).toBe(true);
  });
  it('409 on accept for an order Deliveroo already rejected is a failure', async () => {
    setup((c) =>
      c.method === 'PATCH'
        ? {
            status: 409,
            json: { error: { code: 'invalid_status_transition' } },
          }
        : { status: 200, json: { status: 'rejected' } },
    );
    const r = await p.acceptOrder(conn(), 'ae:rej');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('rejected');
  });
  it('503 order_not_ready is retried after Retry-After, and gives up after 3 attempts', async () => {
    let n = 0;
    const http = setup(() =>
      ++n < 3
        ? {
            status: 503,
            json: { error: { code: 'order_not_ready' } },
            retryAfter: 4,
          }
        : { status: 204 },
    );
    expect((await p.acceptOrder(conn(), 'ae:nr')).ok).toBe(true);
    expect(p.sleep).toHaveBeenCalledWith(4000);
    expect(http.calls.filter((x) => x.method === 'PATCH')).toHaveLength(3);
    const always = setup(() => ({
      status: 503,
      json: { error: { code: 'order_not_ready' } },
      retryAfter: 99,
    }));
    const r = await p.acceptOrder(conn(), 'ae:nr2');
    expect(r.ok).toBe(false);
    expect(always.calls.filter((x) => x.method === 'PATCH')).toHaveLength(3);
    expect(p.sleep).toHaveBeenCalledWith(10_000); // capped
  });
  it('allows 5 status updates a minute per order and refuses the 6th without calling Deliveroo', async () => {
    const http = setup(() => ({ status: 500 }));
    for (let i = 0; i < 5; i++) await p.acceptOrder(conn(), 'ae:rl');
    const before = http.calls.filter((x) => x.method === 'PATCH').length;
    const r = await p.acceptOrder(conn(), 'ae:rl');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('5 updates a minute');
    expect(http.calls.filter((x) => x.method === 'PATCH').length).toBe(before);
    // another order is unaffected
    expect((await p.acceptOrder(conn(), 'ae:other')).ok).toBe(false); // 500 from the fake, but it WAS called
    expect(http.calls.filter((x) => x.method === 'PATCH').length).toBe(
      before + 1,
    );
  });
  it('refuses an order id that could change the path', async () => {
    setup(() => ({ status: 204 }));
    expect((await p.acceptOrder(conn(), '../../x')).ok).toBe(false);
    expect((await p.acceptOrder(conn(), 'a b')).ok).toBe(false);
  });
  it('uses the connection credentials, falling back to the platform sandbox ones, and fails clearly with neither', async () => {
    const oldId = process.env.DELIVEROO_SANDBOX_CLIENT_ID;
    const oldSecret = process.env.DELIVEROO_SANDBOX_CLIENT_SECRET;
    try {
      delete process.env.DELIVEROO_SANDBOX_CLIENT_ID;
      delete process.env.DELIVEROO_SANDBOX_CLIENT_SECRET;
      setup(() => ({ status: 204 }));
      const r = await p.acceptOrder(
        conn({ credentials: { other: 'x' } }),
        'ae:nc',
      );
      expect(r).toEqual({
        ok: false,
        message: 'Deliveroo needs both a Client ID and a Client secret',
      });
      process.env.DELIVEROO_SANDBOX_CLIENT_ID = 'platform-fake-id';
      process.env.DELIVEROO_SANDBOX_CLIENT_SECRET = 'platform-fake-secret';
      const http = setup(() => ({ status: 204 }));
      expect(
        (await p.acceptOrder(conn({ credentials: { other: 'x' } }), 'ae:pc'))
          .ok,
      ).toBe(true);
      const tokenCall = http.calls.find((x) =>
        x.url.includes('/oauth2/token'),
      )!;
      expect(String(tokenCall.body)).toContain('client_id=platform-fake-id');
    } finally {
      if (oldId === undefined) delete process.env.DELIVEROO_SANDBOX_CLIENT_ID;
      else process.env.DELIVEROO_SANDBOX_CLIENT_ID = oldId;
      if (oldSecret === undefined)
        delete process.env.DELIVEROO_SANDBOX_CLIENT_SECRET;
      else process.env.DELIVEROO_SANDBOX_CLIENT_SECRET = oldSecret;
    }
  });
  it('markReady -> POST prep_stage ready_for_collection (a human action; nothing calls it automatically)', async () => {
    const http = setup(() => ({ status: 200 }));
    expect((await p.markReady(conn(), 'ae:rdy')).ok).toBe(true);
    const c = http.calls.find(
      (x) => x.method === 'POST' && x.url.includes('prep_stage'),
    )!;
    expect(c.url).toBe(`${orderUrl('ae:rdy')}/prep_stage`);
    expect(c.body).toMatchObject({ stage: 'ready_for_collection' });
  });
  it('fetchOrderStatus maps the status, 404 is null, other failures throw', async () => {
    setup(() => ({ status: 200, json: { status: 'canceled' } }));
    expect(await p.fetchOrderStatus(conn(), 'ae:s')).toEqual({
      status: 'cancelled',
      externalStatus: 'canceled',
    });
    setup(() => ({ status: 404 }));
    expect(await p.fetchOrderStatus(conn(), 'ae:s')).toBeNull();
    setup(() => ({ status: 500 }));
    await expect(p.fetchOrderStatus(conn(), 'ae:s')).rejects.toBeInstanceOf(
      DeliverooCallError,
    );
  });
  it('setItemAvailability -> POST item_unavailabilities with the menu id and site', async () => {
    const http = setup(() => ({ status: 200 }));
    const r = await p.setItemAvailability(conn(), [
      { externalItemId: 'A', available: false },
      { externalItemId: 'B', available: true },
    ]);
    expect(r.ok).toBe(true);
    const c = http.calls.find(
      (x) => x.method === 'POST' && x.url.includes('item_unavailabilities'),
    )!;
    expect(c.url).toBe(
      `${DELIVEROO_SANDBOX.menuBase}/v1/brands/FAKE-BRAND-1/menus/requital-c7/item_unavailabilities/FAKE-SITE-1`,
    );
    expect(c.body).toEqual({
      item_unavailabilities: [
        { item_id: 'A', status: 'unavailable' },
        { item_id: 'B', status: 'available' },
      ],
    });
    expect(
      (await p.setItemAvailability(conn({ externalSiteId: null }), [])).ok,
    ).toBe(false);
  });
  it('pushCatalogue -> PUT menu with stable item ids, minor-unit prices and NO invented tax rate', async () => {
    const http = setup(() => ({ status: 200 }));
    const items = [
      {
        externalItemId: 'ROSE-1',
        name: 'Roses',
        priceMinor: 12000,
        currency: 'AED',
        available: true,
      },
    ];
    expect((await p.pushCatalogue(conn(), items)).ok).toBe(true);
    expect((await p.pushCatalogue(conn(), items)).ok).toBe(true);
    const puts = http.calls.filter((x) => x.method === 'PUT');
    expect(puts[0].url).toBe(
      `${DELIVEROO_SANDBOX.menuBase}/v1/brands/FAKE-BRAND-1/menus/requital-c7`,
    );
    expect(puts[0].body).toEqual(puts[1].body); // same ids every push
    const body = puts[0].body as {
      site_ids: string[];
      menu: { items: Record<string, unknown>[] };
    };
    expect(body.site_ids).toEqual(['FAKE-SITE-1']);
    expect(body.menu.items[0]).toMatchObject({
      id: 'ROSE-1',
      price_info: { price: 12000 },
    });
    expect(body.menu.items[0]).not.toHaveProperty('tax_rate');
  });
  it('testConnection: token only without a brand id; never claims to prove ownership; never echoes credentials', async () => {
    setup(() => ({ status: 200, json: { orders: [] } }));
    const ok = await p.testConnection(conn({ externalBrandId: null }));
    expect(ok).toMatchObject({ ok: true, provesLocation: false });
    const withBrand = await p.testConnection(conn());
    expect(withBrand).toMatchObject({ ok: true, provesLocation: false });
    setup(() => ({ status: 404 }));
    const bad = await p.testConnection(conn());
    expect(bad.ok).toBe(false);
    p.api.fetchImpl = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: FAKE_CLIENT_SECRET }), {
          status: 401,
        }),
      );
    const denied = await p.testConnection(conn());
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).not.toContain(FAKE_CLIENT_SECRET);
    expect(p.capabilities.provesLocationOwnership).toBe(false);
  });
  it('listOpenOrders -> deterministic event ids, paging, order.new for placed, drops another location', async () => {
    const a = fakeOrder({ id: 'ae:poll-a', status: 'placed' });
    const b = fakeOrder({ id: 'ae:poll-b', status: 'accepted' });
    const other = fakeOrder({ id: 'ae:poll-c', location_id: 'SOMEONE-ELSE' });
    let page = 0;
    const http = setup(() =>
      ++page === 1
        ? { status: 200, json: { orders: [a, other], next: 'CUR1' } }
        : { status: 200, json: { orders: [b] } },
    );
    const first = await p.listOpenOrders(conn());
    expect(first.map((e) => e.eventId)).toEqual([
      'poll:ae:poll-a:placed',
      'poll:ae:poll-b:accepted',
    ]);
    expect((first[0].payload as { event: string }).event).toBe('order.new');
    expect((first[1].payload as { event: string }).event).toBe(
      'order.status_update',
    );
    expect(http.calls.filter((x) => x.method === 'GET')[0].url).toBe(
      `${DELIVEROO_SANDBOX.orderBase}/v2/brand/FAKE-BRAND-1/restaurant/FAKE-LOC-1/orders?live_orders=true`,
    );
    expect(http.calls.filter((x) => x.method === 'GET')[1].url).toContain(
      'cursor=CUR1',
    );
    page = 0;
    const second = await p.listOpenOrders(conn());
    expect(second.map((e) => e.eventId)).toEqual(first.map((e) => e.eventId));
    await expect(
      p.listOpenOrders(conn({ externalBrandId: null })),
    ).rejects.toBeInstanceOf(DeliverooCallError);
  });
  it('does not implement what it cannot do (no guessed endpoints)', () => {
    const q = new DeliverooChannelProvider();
    expect(q.capabilities).toMatchObject({
      removeItem: false,
      substituteItems: false,
      branchStatus: false,
      prepTimeAdjust: false,
    });
  });
});
