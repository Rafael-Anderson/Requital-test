/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- bodies are untyped supertest JSON */
import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { bootApp, makeFixtures, body, type W5Shop } from './helpers/w5-fixture';
import { createStaffToken } from './helpers/staff-login';
import { DatabaseService } from '../src/database/database.service';
import { ChannelIngestionService } from '../src/channels/channel-ingestion.service';
import { ChannelSweepService } from '../src/channels/channel-sweep.service';
import { ChannelWebhookRejectedException } from '../src/channels/channel-ingestion.service';
import type { BoundChannelConnection } from '../src/channels/channel.types';
import { TalabatChannelProvider } from '../src/channels/providers/talabat/talabat-channel.provider';
import {
  TalabatSimulator,
  type SimOrderSpec,
  type TalabatOrderBody,
} from '../src/channels/providers/talabat/talabat-simulator';

jest.setTimeout(300000);

const TALABAT = 'talabat';

// E3: Talabat behind the in-repo simulator, through the real pipeline. No call
// leaves the process (the provider has no network client). The marketplace rules
// of E1 are re-asserted here for Talabat's shape: shared-secret webhook, store
// routing, item-level discounts, no gateway charge, minimal customer data.
describe('Marketplace channels: Talabat simulator (E3)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let ingestion: ChannelIngestionService;
  let sweep: ChannelSweepService;
  let sim: TalabatSimulator;
  let provider: TalabatChannelProvider;
  const r = () => request(app.getHttpServer());
  const h = (s: W5Shop) => ({ Authorization: `Bearer ${s.adminToken}` });

  interface TConn {
    shop: W5Shop;
    id: number;
    store: string;
    chain: string;
    secret: string;
    creds: Record<string, string>;
  }

  let platform: { cookie: string; csrf: string };
  let a: W5Shop;
  let b: W5Shop;
  let ta: TConn;
  let tb: TConn;

  async function grantFlag(shop: W5Shop) {
    await db.execute(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'marketplace_channels', 1)
       ON DUPLICATE KEY UPDATE enabled = 1`,
      [shop.shopId],
    );
  }

  function staffVerify(c: TConn) {
    return r()
      .post(
        `/platform-admin/shops/${c.shop.shopId}/channel-connections/${c.id}/verify-location`,
      )
      .set('Cookie', platform.cookie)
      .set('X-CSRF-Token', platform.csrf)
      .send({
        externalLocationId: c.store,
        externalBrandId: null,
        externalSiteId: null,
      });
  }

  // Creates (and by default verifies and enables) a Talabat connection. The
  // simulator account is registered first, as it would be after a contract.
  async function tconnect(
    shop: W5Shop,
    o: {
      apiBase?: string;
      contract?: boolean;
      verify?: boolean;
      enable?: boolean;
    } = {},
  ) {
    const u = f.uniq();
    const c: TConn = {
      shop,
      id: 0,
      store: `store-${u}`,
      chain: `chain-${u}`,
      secret: `wh-secret-${u}-abcd`,
      creds: {
        clientId: `cid-${u}`,
        clientSecret: `csecret-${u}-xyz`,
        chainId: `chain-${u}`,
        ...(o.apiBase ? { apiBase: o.apiBase } : {}),
      },
    };
    sim.registerAccount({
      clientId: c.creds.clientId,
      clientSecret: c.creds.clientSecret,
      chainId: c.chain,
      contractSigned: o.contract ?? true,
      vendorIds: [c.store],
    });
    const created = await r()
      .post('/channels/connections')
      .set(h(shop))
      .send({
        outletId: shop.outletId,
        provider: TALABAT,
        externalLocationId: c.store,
        credentials: c.creds,
        webhookSecret: c.secret,
      })
      .expect(201);
    c.id = body<{ id: number }>(created).id;
    if (o.verify !== false) await staffVerify(c).expect(201);
    let enable;
    if (o.enable !== false)
      enable = await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(shop))
        .send({ enabled: true });
    return { c, enable };
  }

  const bound = (c: TConn): BoundChannelConnection => ({
    id: c.id,
    shopId: c.shop.shopId,
    outletId: c.shop.outletId,
    provider: TALABAT,
    externalLocationId: c.store,
    externalBrandId: null,
    externalSiteId: null,
    credentials: c.creds,
    webhookSecret: c.secret,
  });

  const place = (c: TConn, spec: SimOrderSpec) =>
    sim.placeOrder(c.chain, c.store, spec);

  function deliver(
    c: TConn,
    payload: Record<string, unknown>,
    o: { secret?: string; header?: string | null; inline?: boolean } = {},
  ) {
    const headers: Record<string, string> = {};
    if (o.header !== null)
      headers.authorization = o.header ?? o.secret ?? c.secret;
    return ingestion.receive({
      provider: TALABAT,
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers,
      processInline: o.inline ?? true,
    });
  }

  async function link(c: TConn, orderId: string) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
      [c.id, orderId],
    );
    return rows[0];
  }

  const mapItem = (shop: W5Shop, sku: string, productId: number) =>
    r()
      .post('/channels/mappings')
      .set(h(shop))
      .send({ provider: TALABAT, externalItemId: sku, productId });

  const product = (shop: W5Shop, stock: number, price = 25) =>
    f.stockedProduct(shop, stock, { price });

  beforeAll(async () => {
    const booted = await bootApp();
    app = booted.app;
    db = booted.db;
    f = makeFixtures(app, db);
    ingestion = app.get(ChannelIngestionService);
    sweep = app.get(ChannelSweepService);
    sim = app.get(TalabatSimulator);
    provider = app.get(TalabatChannelProvider);
    const email = `tlb-staff-${f.runId}@test.com`;
    await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [email, await bcrypt.hash('platform-password-123', 10), 'Tlb Staff'],
    );
    const login = await r()
      .post('/platform-auth/login')
      .send({ email, password: 'platform-password-123' })
      .expect(201);
    const jar: Record<string, string> = {};
    for (const line of login.get('Set-Cookie') ?? []) {
      const pair = line.split(';')[0];
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    platform = {
      cookie: Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      csrf: login.get('X-CSRF-Token') as string,
    };
    a = await f.setupShop('tlb-a');
    b = await f.setupShop('tlb-b');
    await grantFlag(a);
    await grantFlag(b);
    await db.execute(
      `UPDATE outlet SET whatsapp = '+971501112233' WHERE id IN (?, ?)`,
      [a.outletId, b.outletId],
    );
    ta = (await tconnect(a)).c;
    tb = (await tconnect(b)).c;
  });
  beforeEach(() => {
    sim.log.length = 0;
    sim.failNext = null;
    sim.now = () => Date.now();
  });
  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('a real Talabat connection is impossible', () => {
    it('lists the provider without a merchant-bound location proof', async () => {
      const res = await r().get('/channels/providers').set(h(a)).expect(200);
      const t = body<{ name: string; capabilities: Record<string, boolean> }[]>(
        res,
      ).find((p) => p.name === TALABAT)!;
      expect(t.capabilities).toMatchObject({
        provesLocationOwnership: false,
        platformWebhookSecret: false,
        acceptReject: true,
        markReady: true,
        itemAvailability: true,
        branchStatus: true,
        catalogueSync: true,
        prepTimeAdjust: true,
      });
    });

    it('refuses to enable against any real endpoint and never calls out', async () => {
      const s = await f.setupShop('tlb-real');
      await grantFlag(s);
      const { c, enable } = await tconnect(s, {
        apiBase: 'https://talabat.partner.deliveryhero.io',
      });
      expect(enable!.status).toBe(400);
      expect(JSON.stringify(enable!.body)).toContain('simulator');
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT enabled, lastSyncStatus FROM channelconnection WHERE id = ?`,
        [c.id],
      );
      expect(!!row.enabled).toBe(false);
      expect(row.lastSyncStatus).toBe('failed');
      // Not a single simulator request either: the guard runs first.
      expect(sim.log).toEqual([]);
      // The endpoint cannot be edited in while enabled-or-not either: even an
      // admin who swaps the credentials afterwards hits the same wall.
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(s))
        .send({
          credentials: { ...c.creds, apiBase: 'https://api.talabat.com' },
        })
        .expect(200);
      await r()
        .post(`/channels/connections/${c.id}/test`)
        .set(h(s))
        .expect((res) => expect(res.body.ok === true).toBe(false));
      expect(sim.log).toEqual([]);
    });

    it('needs a signed contract, and staff verification of the store', async () => {
      const s = await f.setupShop('tlb-contract');
      await grantFlag(s);
      const noContract = await tconnect(s, { contract: false });
      expect(noContract.enable!.status).toBe(400);
      expect(JSON.stringify(noContract.enable!.body)).toContain('contract');
      const s2 = await f.setupShop('tlb-unverified');
      await grantFlag(s2);
      const unverified = await tconnect(s2, { verify: false });
      expect(unverified.enable!.status).toBe(409);
      // Chain-level credentials that work are still not an ownership proof.
      expect(sim.log.filter((l) => l.op === 'token')).toHaveLength(1);
    });

    it('creates no connection when the simulator is not registered', async () => {
      // The same gate production relies on: an unregistered provider is unknown.
      const res = await r()
        .post('/channels/connections')
        .set(h(a))
        .send({ outletId: a.outletId, provider: 'talabat-live' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('Unknown channel provider');
    });
  });

  // -------------------------------------------------------------------------
  describe('the order endpoint (webhook)', () => {
    it('creates a marketplace order with item-level discounts captured and no charge', async () => {
      const p = await product(a, 10);
      const q = await product(a, 10);
      await mapItem(a, 'sku-d', p.id);
      await mapItem(a, 'sku-n', q.id);
      const o = place(ta, {
        items: [
          { sku: 'sku-d', unitPrice: 25, quantity: 2, discount: '5.00' },
          { sku: 'sku-n', unitPrice: 10 },
        ],
        payment: { discount: '5.00', total_taxes: '2.5', order_total: 55 },
        deliveryType: 'PLATFORM_DELIVERY',
      });
      const res = await deliver(ta, o);
      expect(res.duplicate).toBe(false);
      const co = await link(ta, o.order_id);
      expect(co.state).toBe('pending_acceptance');
      const order = await f.orderRow(co.orderId);
      expect(order.channel).toBe(TALABAT);
      expect(order.paymentMethod).toBe(TALABAT);
      expect(order.customerId).toBeNull();
      expect(order.customerEmail).toBeNull();
      expect(order.trackingToken).toBeNull();
      expect(order.orderType).toBe('pickup');
      expect(Number(order.total)).toBe(55);
      expect(Number(order.discountAmount)).toBe(5);
      expect(Number(order.taxAmount)).toBe(2.5);
      expect(co.commissionAmount).toBeNull();
      // Minimal data: the marketplace courier delivers, so no phone or address.
      expect(order.customerPhone).toBe('');
      expect(order.customerAddress).toBe('');
      const items = await f.orderItems(co.orderId);
      const d = items.find((i) => i.productId === p.id)!;
      const n = items.find((i) => i.productId === q.id)!;
      expect(Number(d.priceAtPurchase)).toBe(25); // before the discount
      expect(Number(d.marketplaceDiscountAmount)).toBe(5);
      expect(n.marketplaceDiscountAmount).toBeNull(); // not stated: unknown
      expect(d.taxAmount).toBeNull();
      const tx = await db.query<RowDataPacket[]>(
        `SELECT 1 FROM paymenttransaction WHERE orderId = ?`,
        [co.orderId],
      );
      expect(tx).toHaveLength(0);
      expect(await f.productStock(a.outletId, p.id)).toBe(8);
      // The admin order response carries the captured discount.
      const detail = await r()
        .get(`/orders/${co.orderId}`)
        .set(h(a))
        .expect(200);
      const line = body<{ orderitem: Record<string, unknown>[] }>(
        detail,
      ).orderitem.find((i) => i.productId === p.id)!;
      expect(line.marketplaceDiscountAmount).toBe('5');
    });

    it('reads a three-decimal currency exactly, discount included', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'kwd-sku', p.id);
      const o = place(ta, {
        currency: 'KWD',
        items: [
          {
            sku: 'kwd-sku',
            unitPrice: '10.505',
            quantity: 3,
            discount: '1.505',
          },
        ],
        deliveryFee: '0.500',
        payment: { order_total: '30.510' },
      });
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      const order = await f.orderRow(co.orderId);
      expect(order.currency).toBe('KWD');
      expect(Number(order.total)).toBeCloseTo(30.51, 3);
      const [item] = await f.orderItems(co.orderId);
      expect(item.priceAtPurchase).toMatch(/^10\.505/);
      expect(item.marketplaceDiscountAmount).toMatch(/^1\.505/);
    });

    it('rejects a wrong, missing or other-shop credential identically, and writes nothing', async () => {
      const p = await product(a, 5);
      await mapItem(a, 'sku-auth', p.id);
      const o = place(ta, { items: [{ sku: 'sku-auth', unitPrice: 25 }] });
      const before = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM channelinboundevent WHERE shopId = ?`,
        [a.shopId],
      );
      const attempts = [
        deliver(ta, o, { secret: 'not-the-secret' }),
        deliver(ta, o, { header: null }),
        deliver(ta, o, { header: '' }),
        deliver(ta, o, { secret: tb.secret }), // another shop's secret
        deliver(ta, o, { secret: ta.secret.toUpperCase() }),
      ];
      for (const x of attempts)
        await expect(x).rejects.toBeInstanceOf(ChannelWebhookRejectedException);
      // An unknown store is indistinguishable from a bad secret.
      const stranger = {
        ...o,
        client: { ...(o.client as object), store_id: 'no-such-store' },
      };
      await expect(deliver(ta, stranger)).rejects.toBeInstanceOf(
        ChannelWebhookRejectedException,
      );
      const after = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM channelinboundevent WHERE shopId = ?`,
        [a.shopId],
      );
      expect(after[0].n).toBe(before[0].n);
      expect(await link(ta, o.order_id)).toBeUndefined();
      // The Basic form of the right secret is accepted.
      await deliver(ta, o, { header: `Basic ${ta.secret}` });
      expect(await link(ta, o.order_id)).toBeDefined();
    });

    it('a store belongs to one shop: shop B cannot see, accept or be fed shop A orders', async () => {
      const p = await product(a, 5);
      await mapItem(a, 'sku-iso', p.id);
      const o = place(ta, { items: [{ sku: 'sku-iso', unitPrice: 25 }] });
      // Shop A's store id signed with shop B's secret: rejected.
      await expect(
        deliver(ta, o, { secret: tb.secret }),
      ).rejects.toBeInstanceOf(ChannelWebhookRejectedException);
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(b)).expect(404);
      const list = await r().get('/channels/orders').set(h(b)).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(o.order_id);
      // Another shop cannot enable a connection for shop A's store, even with
      // valid credentials and a staff verification of its own (one enabled
      // owner per store, platform-wide), and the answer does not say whose.
      const s = await f.setupShop('tlb-claim');
      await grantFlag(s);
      const claim = await tconnect(s, { verify: false, enable: false });
      await db.execute(
        `UPDATE channelconnection SET externalLocationId = ? WHERE id = ?`,
        [ta.store, claim.c.id],
      );
      sim.registerAccount({
        clientId: claim.c.creds.clientId,
        clientSecret: claim.c.creds.clientSecret,
        chainId: claim.c.chain,
        contractSigned: true,
        vendorIds: [ta.store],
      });
      claim.c.store = ta.store;
      await staffVerify(claim.c).expect(201);
      const enable = await r()
        .post(`/channels/connections/${claim.c.id}/enabled`)
        .set(h(s))
        .send({ enabled: true })
        .expect(409);
      expect(JSON.stringify(enable.body)).not.toContain(String(a.shopId));
    });

    it('treats a retried or concurrent identical delivery as one order', async () => {
      const p = await product(a, 20);
      await mapItem(a, 'sku-dup', p.id);
      const o = place(ta, { items: [{ sku: 'sku-dup', unitPrice: 25 }] });
      const results = await Promise.all(
        Array.from({ length: 8 }, () => deliver(ta, o)),
      );
      expect(results.filter((x) => !x.duplicate)).toHaveLength(1);
      // Talabat's documented retry: five more identical deliveries.
      for (let i = 0; i < 5; i++)
        expect((await deliver(ta, o)).duplicate).toBe(true);
      const n = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
        [ta.id, o.order_id],
      );
      expect(n[0].n).toBe(1);
      expect(await f.productStock(a.outletId, p.id)).toBe(19);
    });

    it('a changed redelivery of the same order is a new inbox row but never a second order', async () => {
      const p = await product(a, 20);
      await mapItem(a, 'sku-chg', p.id);
      const o = place(ta, { items: [{ sku: 'sku-chg', unitPrice: 25 }] });
      await deliver(ta, o);
      const changed = { ...o, order_code: 'ZZZZ' };
      const res = await deliver(ta, changed);
      expect(res.duplicate).toBe(false);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT o.id FROM channelorder co JOIN \`order\` o ON o.id = co.orderId
          WHERE co.connectionId = ? AND co.externalOrderId = ?`,
        [ta.id, o.order_id],
      );
      expect(rows).toHaveLength(1);
      expect(await f.productStock(a.outletId, p.id)).toBe(19);
    });

    it('keeps an order with an unknown item visible and creates it once mapped', async () => {
      const o = place(ta, { items: [{ sku: 'sku-new', unitPrice: 12 }] });
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      expect(co.state).toBe('needs_mapping');
      expect(co.orderId).toBeNull();
      const un = await r()
        .get('/channels/unmapped-items')
        .set(h(a))
        .expect(200);
      expect(JSON.stringify(un.body)).toContain('sku-new');
      const p = await product(a, 5);
      const unmapped = body<{ id: number; externalItemId: string }[]>(un).find(
        (u) => u.externalItemId === 'sku-new',
      )!;
      await r()
        .post(`/channels/unmapped-items/${unmapped.id}/resolve`)
        .set(h(a))
        .send({ productId: p.id })
        .expect(201);
      expect((await link(ta, o.order_id)).state).toBe('pending_acceptance');
    });

    it('garbage in an optional figure leaves it NULL and still creates the order', async () => {
      const p = await product(a, 5);
      await mapItem(a, 'sku-garbage', p.id);
      const o = place(ta, {
        items: [{ sku: 'sku-garbage', unitPrice: 25, discount: '5%' }],
        payment: { total_taxes: '-1', discount: 'abc', delivery_fee: '1e2' },
      });
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      expect(co.state).toBe('pending_acceptance');
      const order = await f.orderRow(co.orderId);
      expect(order.taxAmount).toBeNull();
      expect(order.discountAmount).toBeNull();
      expect(
        (await f.orderItems(co.orderId))[0].marketplaceDiscountAmount,
      ).toBeNull();
    });

    it('a delivery the merchant makes keeps the phone and address', async () => {
      const p = await product(a, 5);
      await mapItem(a, 'sku-own', p.id);
      const o = place(ta, {
        items: [{ sku: 'sku-own', unitPrice: 25 }],
        deliveryType: 'VENDOR_DELIVERY',
      });
      await deliver(ta, o);
      const order = await f.orderRow((await link(ta, o.order_id)).orderId);
      expect(order.orderType).toBe('delivery');
      expect(order.customerAddress).toBe('Marina, Dubai');
    });

    it('an unreadable order is dead-lettered visibly, never silently dropped', async () => {
      const o = place(ta, {
        items: [{ sku: 'x', unitPrice: 5 }],
        currency: null,
      });
      const res = await deliver(ta, o);
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT status, lastError FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(row.status).toBe('dead');
      expect(row.lastError).toContain('currency');
    });

    it('is durable before it is acknowledged, and processed after', async () => {
      const p = await product(a, 5);
      await mapItem(a, 'sku-later', p.id);
      const o = place(ta, { items: [{ sku: 'sku-later', unitPrice: 25 }] });
      const res = await deliver(ta, o, { inline: false });
      expect(res.duplicate).toBe(false);
      // The row is committed by the time receive() returns.
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT id FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(row).toBeDefined();
      // Processing happens after the acknowledgement (or, failing that, the sweep).
      for (let i = 0; i < 50 && !(await link(ta, o.order_id)); i++)
        await new Promise((ok) => setTimeout(ok, 100));
      await ingestion.processInboxEvent(res.inboxId);
      expect((await link(ta, o.order_id)).state).toBe('pending_acceptance');
    });
  });

  // -------------------------------------------------------------------------
  describe('acceptance, cancellation and the polling fallback', () => {
    it('accept tells Talabat; a failing call changes nothing and a retry works', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'sku-acc', p.id);
      const o = place(ta, { items: [{ sku: 'sku-acc', unitPrice: 25 }] });
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      sim.failNext = 'put_order:UPDATE_CART';
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(502);
      expect((await link(ta, o.order_id)).state).toBe('pending_acceptance');
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect((await link(ta, o.order_id)).state).toBe('accepted');
      expect(
        (await provider.fetchOrderStatus(bound(ta), o.order_id))?.status,
      ).toBe('accepted');
      // Repeat is a no-op, and stock was held once.
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect(await f.productStock(a.outletId, p.id)).toBe(9);
    });

    it('reject cancels at Talabat with a documented reason and returns the stock', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'sku-rej', p.id);
      const o = place(ta, { items: [{ sku: 'sku-rej', unitPrice: 25 }] });
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      await r()
        .post(`/channels/orders/${co.id}/reject`)
        .set(h(a))
        .send({ reason: 'too busy' })
        .expect(201);
      expect((await link(ta, o.order_id)).state).toBe('rejected');
      expect(
        await provider.fetchOrderStatus(bound(ta), o.order_id),
      ).toMatchObject({
        status: 'cancelled',
      });
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
    });

    it('a cancellation from Talabat closes a pending order and restores stock', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'sku-can', p.id);
      const o = place(ta, { items: [{ sku: 'sku-can', unitPrice: 25 }] });
      await deliver(ta, o);
      await deliver(ta, sim.cancelFromTalabat(o.order_id));
      expect((await link(ta, o.order_id)).state).toBe('cancelled_upstream');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
    });

    it('a ready-for-pickup event on an accepted order is processed, not an error', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'sku-rdy', p.id);
      const o = place(ta, { items: [{ sku: 'sku-rdy', unitPrice: 25 }] });
      await deliver(ta, o);
      const co = await link(ta, o.order_id);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect((await provider.markReady(bound(ta), o.order_id)).ok).toBe(true);
      const res = await deliver(ta, { ...o, status: 'READY_FOR_PICKUP' });
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT status FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(row.status).toBe('processed');
      expect((await link(ta, o.order_id)).externalStatus).toBe(
        'READY_FOR_PICKUP',
      );
    });

    it('an order the webhook never delivered arrives through polling, once', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'sku-poll', p.id);
      const o = place(ta, { items: [{ sku: 'sku-poll', unitPrice: 25 }] });
      for (let i = 0; i < 2; i++) {
        await db.execute(
          `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
          [ta.id],
        );
        await sweep.pollConnections();
      }
      const rows = await db.query<RowDataPacket[]>(
        `SELECT id FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
        [ta.id, o.order_id],
      );
      expect(rows).toHaveLength(1);
      expect(await f.productStock(a.outletId, p.id)).toBe(9);
      const [c] = await db.query<RowDataPacket[]>(
        `SELECT lastSyncStatus FROM channelconnection WHERE id = ?`,
        [ta.id],
      );
      expect(c.lastSyncStatus).toBe('ok');
    });
  });

  // -------------------------------------------------------------------------
  describe('ingestion success and failure rate per connection (admin API)', () => {
    async function seedInbox(c: TConn, processed: number, dead: number) {
      const rows: [number, number, string, string, string][] = [];
      for (let i = 0; i < processed + dead; i++)
        rows.push([
          c.shop.shopId,
          c.id,
          `slo-${f.uniq()}-${i}`,
          'a'.repeat(64),
          i < processed ? 'processed' : 'dead',
        ]);
      await db.execute(
        `INSERT INTO channelinboundevent (shopId, connectionId, provider, eventId, signatureVerified, payloadHash, status, receivedAt)
         VALUES ${rows.map(() => `(?, ?, 'talabat', ?, 1, ?, ?, NOW(3))`).join(', ')}`,
        rows.flat(),
      );
    }
    const per = async (shop: W5Shop, id: number) => {
      const res = await r()
        .get('/channels/stats/connections?sinceMinutes=60')
        .set(h(shop))
        .expect(200);
      return body<Record<string, any>[]>(res).find(
        (x) => x.connectionId === id,
      );
    };

    it('computes both rates and checks them against the targets, per connection', async () => {
      const s = await f.setupShop('tlb-slo');
      await grantFlag(s);
      const { c } = await tconnect(s);
      // Nothing finished yet: no verdict, never "100%".
      expect(await per(s, c.id)).toMatchObject({
        provider: TALABAT,
        received: 0,
        ingestionSuccessPct: null,
        failurePct: null,
        meetsIngestionTarget: null,
        meetsFailureTarget: null,
      });
      // Real traffic: three orders in, one unreadable.
      const p = await product(s, 10);
      await mapItem(s, 'slo-sku', p.id);
      for (let i = 0; i < 3; i++)
        await deliver(
          c,
          place(c, { items: [{ sku: 'slo-sku', unitPrice: 5 }] }),
        );
      await deliver(
        c,
        place(c, { items: [{ sku: 'x', unitPrice: 5 }], currency: null }),
      );
      expect(await per(s, c.id)).toMatchObject({
        processed: 3,
        failed: 1,
        dead: 1,
        ingestionSuccessPct: 75,
        failurePct: 25,
        meetsIngestionTarget: false,
        meetsFailureTarget: false,
      });
    });

    it.each([
      // processed, dead, success %, meets success (>= 98.9), failure %, meets failure (<= 2.5)
      [989, 11, 98.9, true, 1.1, true],
      [988, 12, 98.8, false, 1.2, true],
      [976, 24, 97.6, false, 2.4, true],
      [975, 25, 97.5, false, 2.5, true],
      [974, 26, 97.4, false, 2.6, false],
    ])(
      'boundary %d processed + %d dead',
      async (ok, dead, succ, mS, fail, mF) => {
        const s = await f.setupShop(`tlb-e${ok}`);
        await grantFlag(s);
        const { c } = await tconnect(s);
        await seedInbox(c, ok, dead);
        expect(await per(s, c.id)).toMatchObject({
          ingestionSuccessPct: succ,
          meetsIngestionTarget: mS,
          failurePct: fail,
          meetsFailureTarget: mF,
        });
      },
    );

    it('is scoped to the shop, admin-only, and filterable by connection', async () => {
      const other = await per(b, ta.id);
      expect(other).toBeUndefined();
      const all = await r()
        .get('/channels/stats/connections')
        .set(h(b))
        .expect(200);
      expect(JSON.stringify(all.body)).not.toContain(
        `"connectionId":${ta.id},`,
      );
      // A foreign connection id matches no rows: zeros, never A's numbers.
      const foreign = await r()
        .get(`/channels/stats?connectionId=${ta.id}`)
        .set(h(b))
        .expect(200);
      expect(foreign.body.received).toBe(0);
      const mine = await r()
        .get(`/channels/stats?connectionId=${ta.id}`)
        .set(h(a))
        .expect(200);
      expect(mine.body.received).toBeGreaterThan(0);
      await r().get('/channels/stats?connectionId=abc').set(h(a)).expect(400);
      const om = await createStaffToken(
        app,
        a.adminToken,
        'slo',
        'order_manager',
      );
      await r()
        .get('/channels/stats/connections')
        .set({ Authorization: `Bearer ${om}` })
        .expect(403);
    });
  });
});

export type { TalabatOrderBody };
