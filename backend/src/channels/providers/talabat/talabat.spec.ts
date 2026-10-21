import { DeliverooChannelProvider } from '../deliveroo/deliveroo-channel.provider';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ChannelsModule } from '../../channels.module';
import { ChannelProviderRegistry } from '../../channel-provider.registry';
import { StubChannelProvider } from '../stub-channel.provider';
import {
  ChannelParseError,
  type BoundChannelConnection,
} from '../../channel.types';
import { parseTalabatEvent, routingKeyOf } from './talabat-payload';
import {
  TalabatChannelProvider,
  pollEventId,
} from './talabat-channel.provider';
import { TalabatSimulator } from './talabat-simulator';

const CHAIN = 'chain-1';
const STORE = 'store-9';
const CREDS = {
  clientId: 'cid',
  clientSecret: 'super-secret-value',
  chainId: CHAIN,
};

function setup(contractSigned = true) {
  const sim = new TalabatSimulator();
  sim.registerAccount({
    clientId: 'cid',
    clientSecret: CREDS.clientSecret,
    chainId: CHAIN,
    contractSigned,
    vendorIds: [STORE],
  });
  const provider = new TalabatChannelProvider(sim);
  const conn = (
    over: Partial<BoundChannelConnection> = {},
  ): BoundChannelConnection => ({
    id: 1,
    shopId: 1,
    outletId: 1,
    provider: 'talabat',
    externalLocationId: STORE,
    externalBrandId: null,
    externalSiteId: null,
    credentials: { ...CREDS },
    webhookSecret: 'shared-secret',
    ...over,
  });
  return { sim, provider, conn };
}

// The simulator's body is loosely typed; the setters below poke into it.
interface Body {
  items: { pricing: Record<string, unknown> }[];
  payment: Record<string, unknown>;
}

describe('Talabat payload parsing', () => {
  const { sim } = setup();
  const received = (spec: Parameters<TalabatSimulator['placeOrder']>[2]) =>
    sim.placeOrder(CHAIN, STORE, spec);

  it('reads a KWD order exactly and captures item-level discounts', () => {
    const e = parseTalabatEvent(
      received({
        currency: 'KWD',
        items: [
          { sku: 'A', unitPrice: '10.505', quantity: 3, discount: '1.505' },
          { sku: 'B', unitPrice: 2 },
        ],
        payment: { discount: '1.505', total_taxes: '1.5' },
      }),
    );
    if (e.kind !== 'order_new') throw new Error('expected order_new');
    const o = e.order;
    expect(o.currency).toBe('KWD');
    expect(o.lines[0]).toMatchObject({
      externalItemId: 'A',
      quantity: 3,
      unitPriceMinor: 10505,
      discountMinor: 1505,
      taxMinor: null,
    });
    // B states no discount: unknown stays null, never 0.
    expect(o.lines[1].discountMinor).toBeNull();
    expect(o.totals.discountMinor).toBe(1505);
    expect(o.totals.taxMinor).toBe(1500);
    expect(o.totals.totalMinor).toBe(33515); // 31.515 + 2
    expect(o.totals.commissionMinor).toBeNull();
  });

  it('never invents tax, discount, fee or a deadline', () => {
    const e = parseTalabatEvent(
      received({
        items: [{ sku: 'A', unitPrice: 5 }],
        payment: {
          total_taxes: undefined,
          delivery_fee: undefined,
          sub_total: undefined,
        },
      }),
    );
    if (e.kind !== 'order_new') throw new Error('expected order_new');
    expect(e.order.totals).toMatchObject({
      taxMinor: null,
      deliveryFeeMinor: null,
      subtotalMinor: null,
      discountMinor: null,
      commissionMinor: null,
      cashDueMinor: null,
    });
    expect(e.order.acceptBy).toBeNull();
    expect(e.order.scheduledFor).toBeNull();
  });

  it('prices a promoted line before the promotion', () => {
    const e = parseTalabatEvent(
      received({
        items: [
          {
            sku: 'A',
            unitPrice: 8,
            originalUnitPrice: 10,
            quantity: 2,
            discount: 4,
          },
        ],
      }),
    );
    if (e.kind !== 'order_new') throw new Error('expected order_new');
    expect(e.order.lines[0]).toMatchObject({
      unitPriceMinor: 1000,
      discountMinor: 400,
    });
  });

  it('keeps a phone and address only for a delivery the merchant makes', () => {
    const who = (t: string) => {
      const e = parseTalabatEvent(
        received({ items: [{ sku: 'A', unitPrice: 5 }], deliveryType: t }),
      );
      if (e.kind !== 'order_new') throw new Error('x');
      return e.order.customer;
    };
    expect(who('VENDOR_DELIVERY')).toMatchObject({
      name: 'S. K.',
      phone: '+9715XXXXXXX',
      address: 'Marina, Dubai',
    });
    for (const t of ['PLATFORM_DELIVERY', 'PICKUP', 'MYSTERY'])
      expect(who(t)).toMatchObject({
        name: 'S. K.',
        phone: null,
        address: null,
      });
  });

  it('maps delivery type and cash payment', () => {
    const kinds = [
      'PLATFORM_DELIVERY',
      'VENDOR_DELIVERY',
      'PICKUP',
      'MYSTERY',
    ].map((t) => {
      const e = parseTalabatEvent(
        received({ items: [{ sku: 'A', unitPrice: 5 }], deliveryType: t }),
      );
      return e.kind === 'order_new' ? e.order.handover : null;
    });
    expect(kinds).toEqual([
      'marketplace_courier',
      'merchant_delivery',
      'customer_pickup',
      'marketplace_courier',
    ]);
    const cash = parseTalabatEvent(
      received({ items: [{ sku: 'A', unitPrice: 5 }], paymentType: 'CASH' }),
    );
    if (cash.kind !== 'order_new') throw new Error('x');
    expect(cash.order.totals.cashDueMinor).toBe(500);
  });

  it('only schedules a pre-order', () => {
    const body = received({ items: [{ sku: 'A', unitPrice: 5 }] });
    const when = new Date(Date.now() + 3600_000).toISOString();
    const pre = parseTalabatEvent({
      ...body,
      isPreorder: true,
      promised_for: when,
    });
    const live = parseTalabatEvent({
      ...body,
      isPreorder: false,
      promised_for: when,
    });
    expect(pre.kind === 'order_new' && pre.order.scheduledFor).toBe(when);
    expect(live.kind === 'order_new' && live.order.scheduledFor).toBeNull();
  });

  it.each([
    ['currency missing', { currency: null }],
    ['order_total missing', { payment: { order_total: undefined } }],
    ['amount not numeric', { payment: { order_total: 'twelve' } }],
    ['no items', { items: [] }],
    ['order_id missing', { order_id: undefined }],
  ])('dead-letters an unreadable order: %s', (_n, over) => {
    const body = {
      ...received({ items: [{ sku: 'A', unitPrice: 5 }] }),
      ...over,
    } as Record<string, unknown>;
    if ('payment' in over)
      body.payment = {
        ...(received({ items: [{ sku: 'A', unitPrice: 5 }] })
          .payment as object),
        ...over.payment,
      };
    expect(() => parseTalabatEvent(body)).toThrow(ChannelParseError);
  });

  it.each([
    [
      'pricing.discount',
      (b: Body, v: unknown) => (b.items[0].pricing.discount = v),
    ],
    ['payment.sub_total', (b: Body, v: unknown) => (b.payment.sub_total = v)],
    [
      'payment.delivery_fee',
      (b: Body, v: unknown) => (b.payment.delivery_fee = v),
    ],
    ['payment.discount', (b: Body, v: unknown) => (b.payment.discount = v)],
    [
      'payment.total_taxes',
      (b: Body, v: unknown) => (b.payment.total_taxes = v),
    ],
  ])(
    'an unreadable optional figure (%s) is NULL and never loses the order',
    (_n, set) => {
      for (const bad of ['-5', '5%', '1e3', 'abc', {}, -3, '1,5']) {
        const body = received({ items: [{ sku: 'A', unitPrice: 5 }] });
        set(body as unknown as Body, bad);
        const e = parseTalabatEvent(body);
        if (e.kind !== 'order_new') throw new Error('expected order_new');
        const t = e.order.totals;
        expect([
          e.order.lines[0].discountMinor,
          t.subtotalMinor,
          t.deliveryFeeMinor,
          t.discountMinor,
          t.taxMinor,
        ]).toContain(null);
        expect(t.totalMinor).toBe(500);
      }
    },
  );

  it('a line discount larger than the line is not stored', () => {
    const at = (d: number) => {
      const e = parseTalabatEvent(
        received({
          items: [{ sku: 'A', unitPrice: 5, quantity: 2, discount: d }],
        }),
      );
      return e.kind === 'order_new' ? e.order.lines[0].discountMinor : 'x';
    };
    expect(at(10)).toBe(1000); // exactly the line: kept
    expect(at(10.01)).toBeNull();
    expect(at(0)).toBe(0);
  });

  it('turns status events into canonical statuses, and ignores the unmodelled', () => {
    const body = received({ items: [{ sku: 'A', unitPrice: 5 }] });
    const map: Record<string, string> = {
      READY_FOR_PICKUP: 'ready',
      DISPATCHED: 'dispatched',
      CANCELLED: 'cancelled',
    };
    for (const [ext, canon] of Object.entries(map)) {
      const e = parseTalabatEvent({ ...body, status: ext });
      expect(e).toMatchObject({
        kind: 'order_status',
        status: canon,
        externalOrderId: body.order_id,
      });
    }
    expect(parseTalabatEvent({ ...body, status: 'WARNING' }).kind).toBe(
      'ignored',
    );
    // A cancel that carries no items still cancels.
    const bare = parseTalabatEvent({
      order_id: 'o1',
      status: 'CANCELLED',
      client: { store_id: STORE },
    });
    expect(bare).toMatchObject({
      kind: 'order_status',
      status: 'cancelled',
      order: undefined,
    });
  });

  it('routes by client.store_id only', () => {
    expect(
      routingKeyOf({
        client: { store_id: 'S1', external_partner_config_id: 'C2' },
      }),
    ).toBe('S1');
    expect(routingKeyOf({ client: {} })).toBeNull();
    expect(routingKeyOf('x')).toBeNull();
    const { provider } = setup();
    expect(provider.extractRoutingKey(Buffer.from('not json'))).toBeNull();
  });
});

describe('Talabat webhook credential (a shared secret, not an HMAC)', () => {
  const { provider } = setup();
  const verify = (authorization: unknown, secrets = ['shared-secret']) =>
    provider.verifyWebhook({
      rawBody: Buffer.from('{}'),
      headers: { authorization: authorization as string },
      secrets,
    }).valid;

  it('accepts the secret itself or as a Basic value, nothing else', () => {
    expect(verify('shared-secret')).toBe(true);
    expect(verify('Basic shared-secret')).toBe(true);
    expect(verify('shared-secreT')).toBe(false);
    expect(verify('shared-secret-and-more')).toBe(false);
    expect(verify('')).toBe(false);
    expect(verify(undefined)).toBe(false);
    expect(verify('anything', [''])).toBe(false);
    expect(verify('shared-secret', [])).toBe(false);
    expect(verify(['shared-secret'])).toBe(true);
  });
  it('returns no delivery id (Talabat documents none)', () => {
    expect(
      provider.verifyWebhook({
        rawBody: Buffer.from('{}'),
        headers: { authorization: 'shared-secret' },
        secrets: ['shared-secret'],
      }).eventId,
    ).toBeNull();
  });
});

describe('Talabat provider against the simulator', () => {
  it('declares exactly the credential keys it requires', async () => {
    const { provider, conn } = setup();
    const keys = provider.credentialFields.map((f) => f.key);
    expect(keys).toEqual(['clientId', 'clientSecret', 'chainId']);
    expect((await provider.testConnection(conn())).ok).toBe(true);
    for (const k of keys) {
      const creds: Record<string, string> = { ...CREDS };
      delete creds[k];
      expect(
        (await provider.testConnection(conn({ credentials: creds }))).ok,
      ).toBe(false);
    }
  });

  it('refuses any real endpoint before making a single call', async () => {
    const { sim, provider, conn } = setup();
    for (const apiBase of [
      'https://talabat.partner.deliveryhero.io',
      'http://localhost:9999',
      'sim',
      '',
    ]) {
      const c = conn({ credentials: { ...CREDS, apiBase } });
      expect(await provider.testConnection(c)).toMatchObject({
        ok: false,
        provesLocation: false,
      });
      expect(await provider.acceptOrder(c, 'o1')).toMatchObject({
        ok: false,
      });
      await expect(provider.listOpenOrders(c)).rejects.toThrow();
    }
    expect(sim.log).toEqual([]);
    // The simulator spelled out is allowed.
    expect(
      (
        await provider.testConnection(
          conn({ credentials: { ...CREDS, apiBase: 'simulator' } }),
        )
      ).ok,
    ).toBe(true);
  });

  it('needs a signed contract, right credentials and a store of the chain', async () => {
    const a = setup(false);
    expect((await a.provider.testConnection(a.conn())).ok).toBe(false);
    const b = setup();
    const bad = await b.provider.testConnection(
      b.conn({ credentials: { ...CREDS, clientSecret: 'wrong-secret-zzz' } }),
    );
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain('wrong-secret-zzz');
    expect(JSON.stringify(bad)).not.toContain(CREDS.clientSecret);
    expect(
      (await b.provider.testConnection(b.conn({ externalLocationId: 'other' })))
        .ok,
    ).toBe(false);
    const ok = await b.provider.testConnection(b.conn());
    expect(ok.ok).toBe(true);
    // Chain-level credentials never prove who owns a store.
    expect(ok.provesLocation).toBe(false);
    expect(b.provider.capabilities.provesLocationOwnership).toBe(false);
    expect(b.provider.capabilities.platformWebhookSecret).toBe(false);
  });

  it('accept confirms the cart; reject cancels with a documented reason', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    const o = sim.placeOrder(CHAIN, STORE, {
      items: [{ sku: 'A', unitPrice: 5 }],
    });
    expect((await provider.fetchOrderStatus(c, o.order_id))?.status).toBe(
      'placed',
    );
    expect((await provider.acceptOrder(c, o.order_id)).ok).toBe(true);
    expect((await provider.fetchOrderStatus(c, o.order_id))?.status).toBe(
      'accepted',
    );
    const o2 = sim.placeOrder(CHAIN, STORE, {
      items: [{ sku: 'A', unitPrice: 5 }],
    });
    expect(
      (await provider.rejectOrder(c, o2.order_id, 'too busy now')).ok,
    ).toBe(true);
    expect(await provider.fetchOrderStatus(c, o2.order_id)).toMatchObject({
      status: 'cancelled',
    });
    expect(sim.log.map((l) => l.op)).toContain('put_order:CANCELLED');
    // A final order cannot be changed again: the failure is reported, not hidden.
    expect((await provider.acceptOrder(c, o2.order_id)).ok).toBe(false);
    expect(await provider.fetchOrderStatus(c, 'missing')).toBeNull();
  });

  it('food is ready: READY_FOR_PICKUP for platform delivery, DISPATCHED for vendor delivery', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    const p = sim.placeOrder(CHAIN, STORE, {
      items: [{ sku: 'A', unitPrice: 5 }],
    });
    const v = sim.placeOrder(CHAIN, STORE, {
      items: [{ sku: 'A', unitPrice: 5 }],
      deliveryType: 'VENDOR_DELIVERY',
    });
    expect((await provider.markReady(c, p.order_id)).ok).toBe(true);
    expect((await provider.markReady(c, v.order_id)).ok).toBe(true);
    expect(
      (await provider.fetchOrderStatus(c, p.order_id))?.externalStatus,
    ).toBe('READY_FOR_PICKUP');
    expect(
      (await provider.fetchOrderStatus(c, v.order_id))?.externalStatus,
    ).toBe('DISPATCHED');
  });

  it('menu push keeps item ids stable across renames and price changes', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    const item = (name: string, priceMinor: number) => ({
      externalItemId: 'SKU-1',
      name,
      priceMinor,
      currency: 'KWD',
      available: true,
    });
    expect((await provider.pushCatalogue(c, [item('Roses', 10505)])).ok).toBe(
      true,
    );
    expect(
      (await provider.pushCatalogue(c, [item('Red roses', 12000)])).ok,
    ).toBe(true);
    const cat = sim.catalog.get(`${CHAIN}:${STORE}`)!;
    expect([...cat.keys()]).toEqual(['SKU-1']);
    expect(cat.get('SKU-1')?.price).toBe(12);
    await provider.pushCatalogue(c, [item('Roses', 10505)]);
    expect(cat.get('SKU-1')?.price).toBe(10.505);
  });

  it('item availability toggles an item; an unknown item cannot be created by it', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    await provider.pushCatalogue(c, [
      {
        externalItemId: 'A',
        name: 'A',
        priceMinor: 500,
        currency: 'AED',
        available: true,
      },
    ]);
    expect(
      (
        await provider.setItemAvailability(c, [
          { externalItemId: 'A', available: false },
        ])
      ).ok,
    ).toBe(true);
    expect(sim.catalog.get(`${CHAIN}:${STORE}`)!.get('A')).toMatchObject({
      active: false,
      price: 5,
    });
    expect(
      (
        await provider.setItemAvailability(c, [
          { externalItemId: 'NEW', available: true },
        ])
      ).ok,
    ).toBe(false);
  });

  it('branch status and prep time', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    expect((await provider.setBranchStatus(c, 'open')).ok).toBe(true);
    expect(sim.vendorStatus.get(`${CHAIN}:${STORE}`)).toMatchObject({
      status: 'OPEN',
    });
    const until = new Date(Date.now() + 3600_000);
    expect((await provider.setBranchStatus(c, 'busy', until)).ok).toBe(true);
    expect(sim.vendorStatus.get(`${CHAIN}:${STORE}`)).toMatchObject({
      status: 'CLOSED_UNTIL',
      closedReason: 'TOO_BUSY_KITCHEN',
    });
    expect((await provider.setBranchStatus(c, 'closed')).ok).toBe(true);
    expect(sim.vendorStatus.get(`${CHAIN}:${STORE}`)).toMatchObject({
      status: 'CLOSED_TODAY',
    });
    expect((await provider.adjustPrepTime(c, 25)).ok).toBe(true);
    expect(sim.prepTimes.get(`${CHAIN}:${STORE}`)).toBe(25);
    expect((await provider.adjustPrepTime(c, 0)).ok).toBe(false);
    expect((await provider.adjustPrepTime(c, 2.5)).ok).toBe(false);
  });

  it('polling returns open orders with a stable event id per order and status', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    const o = sim.placeOrder(CHAIN, STORE, {
      items: [{ sku: 'A', unitPrice: 5 }],
    });
    const a = await provider.listOpenOrders(c);
    const b = await provider.listOpenOrders(c);
    expect(a.map((x) => x.eventId)).toEqual([`poll:${o.order_id}:RECEIVED`]);
    expect(b.map((x) => x.eventId)).toEqual(a.map((x) => x.eventId));
    await provider.rejectOrder(c, o.order_id, 'x');
    expect(await provider.listOpenOrders(c)).toEqual([]);
  });

  it('a token belongs to its credentials: changed credentials never reuse it', async () => {
    const { sim, provider, conn } = setup();
    sim.registerAccount({
      clientId: 'cid2',
      clientSecret: 'secret-two-value',
      chainId: CHAIN,
      contractSigned: true,
      vendorIds: [STORE],
    });
    const tokens = () => sim.log.filter((l) => l.op === 'token').length;
    await provider.adjustPrepTime(conn(), 10);
    await provider.adjustPrepTime(conn(), 10);
    expect(tokens()).toBe(1);
    const swapped = conn({
      credentials: {
        clientId: 'cid2',
        clientSecret: 'secret-two-value',
        chainId: CHAIN,
      },
    });
    await provider.adjustPrepTime(swapped, 10); // same connection id, new credentials
    expect(tokens()).toBe(2);
    await provider.adjustPrepTime(conn(), 10); // back to the first: its own token
    expect(tokens()).toBe(2);
  });

  it('a long order id keeps the status in the polling event id', () => {
    const long = 'o'.repeat(300);
    const id = pollEventId(long, 'READY_FOR_PICKUP');
    expect(id.length).toBeLessThanOrEqual(191);
    expect(id.endsWith(':READY_FOR_PICKUP')).toBe(true);
    expect(pollEventId(long, 'RECEIVED')).not.toBe(id);
    expect(pollEventId(`${'o'.repeat(299)}p`, 'RECEIVED')).not.toBe(
      pollEventId(long, 'RECEIVED'),
    );
    expect(pollEventId('abc', 'RECEIVED')).toBe('poll:abc:RECEIVED');
  });

  it('caches the token, refreshes before expiry, and honours the 60/min limit', async () => {
    const { sim, provider, conn } = setup();
    const c = conn();
    let t = 1_000_000;
    sim.now = () => t;
    await provider.adjustPrepTime(c, 10);
    await provider.adjustPrepTime(c, 11);
    expect(sim.log.filter((l) => l.op === 'token')).toHaveLength(1);
    t += 2 * 3600_000; // past the 2h token life
    await provider.adjustPrepTime(c, 12);
    expect(sim.log.filter((l) => l.op === 'token')).toHaveLength(2);
    // 60 requests per minute for GET and PUT together.
    const results: boolean[] = [];
    for (let i = 0; i < 62; i++)
      results.push((await provider.adjustPrepTime(c, 10)).ok);
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(59);
    expect(results.at(-1)).toBe(false);
    t += 61_000;
    expect((await provider.adjustPrepTime(c, 10)).ok).toBe(true);
  });

  it('reports an outage as a failed call, never an exception', async () => {
    const { sim, provider, conn } = setup();
    const o = sim.placeOrder(CHAIN, STORE, {
      items: [{ sku: 'A', unitPrice: 5 }],
    });
    sim.failNext = 'put_order:UPDATE_CART';
    const r = await provider.acceptOrder(conn(), o.order_id);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('503');
  });
});

describe('Talabat is simulator-only', () => {
  it('has no network client anywhere in its folder', () => {
    const dir = __dirname;
    const banned =
      /\bfetch\s*\(|from ['"](node:)?https?['"]|require\(['"](node:)?https?['"]\)|axios|undici|XMLHttpRequest|got\(|node-fetch|WebSocket|deliveryhero\.io|talabat\.com/i;
    for (const f of readdirSync(dir).filter(
      (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'),
    )) {
      const code = readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
      expect({ f, hit: banned.exec(code)?.[0] ?? null }).toEqual({
        f,
        hit: null,
      });
    }
  });

  it('is registered only where the stub channel is', () => {
    const prev = {
      n: process.env.NODE_ENV,
      e: process.env.ENABLE_STUB_CHANNEL,
    };
    try {
      for (const [env, flag, expected] of [
        ['production', undefined, false],
        ['production', '1', true],
        ['test', undefined, true],
        ['development', undefined, true],
        [undefined, undefined, false],
      ] as const) {
        (process.env as Record<string, string | undefined>).NODE_ENV = env;
        process.env.ENABLE_STUB_CHANNEL = flag;
        const registry = new ChannelProviderRegistry();
        const sim = new TalabatSimulator();
        new ChannelsModule(
          registry,
          new StubChannelProvider(),
          new TalabatChannelProvider(sim),
          new DeliverooChannelProvider(),
        ).onModuleInit();
        expect(registry.has('talabat')).toBe(expected);
        // Deliveroo is registered everywhere (inert until flag + staff verification).
        expect(registry.has('deliveroo')).toBe(true);
      }
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev.n;
      if (prev.e === undefined) delete process.env.ENABLE_STUB_CHANNEL;
      else process.env.ENABLE_STUB_CHANNEL = prev.e;
    }
  });
});
