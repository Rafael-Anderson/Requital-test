/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- bodies are untyped supertest JSON */
import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { bootApp, makeFixtures, body, type W5Shop } from './helpers/w5-fixture';
import { createStaff } from './helpers/staff-login';
import { DatabaseService } from '../src/database/database.service';
import { OrdersService } from '../src/orders/orders.service';
import { JobsService } from '../src/jobs/jobs.service';
import { ShopAnalyticsService } from '../src/shop-analytics/shop-analytics.service';
import { ConversionEventsService } from '../src/shop-analytics/conversion-events.service';
import { ChannelIngestionService } from '../src/channels/channel-ingestion.service';
import { ChannelSweepService } from '../src/channels/channel-sweep.service';
import { OrderNotificationsService } from '../src/orders/order-notifications.service';
import { MetaWhatsAppProvider } from '../src/whatsapp/providers/meta-whatsapp.provider';
import {
  STUB_PROVIDER,
  StubChannelProvider,
  signStubDelivery,
} from '../src/channels/providers/stub-channel.provider';
import type { CanonicalChannelOrder } from '../src/channels/channel.types';

jest.setTimeout(300000);

// E1 marketplace channels framework, end to end against the deterministic stub
// provider (no network, no credentials). Every rule in the owner brief has a
// test here; the cross-tenant ones are the security-critical ones.
describe('Marketplace channels (E1)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let ingestion: ChannelIngestionService;
  let sweep: ChannelSweepService;
  let stub: StubChannelProvider;
  const r = () => request(app.getHttpServer());
  const h = (s: W5Shop) => ({ Authorization: `Bearer ${s.adminToken}` });

  interface Conn {
    shop: W5Shop;
    id: number;
    locationId: string;
    secret: string;
    outletId: number;
  }

  let platform: { cookie: string; csrf: string; id: number };
  let a: W5Shop;
  let b: W5Shop;
  let ca: Conn;
  let cb: Conn;
  let seq = 0;
  const ext = () => `X-${f.runId}-${++seq}`;

  async function grantFlag(shop: W5Shop, on = true) {
    await db.execute(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'marketplace_channels', ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [shop.shopId, on ? 1 : 0],
    );
  }

  async function connect(
    shop: W5Shop,
    outletId = shop.outletId,
    locationId = `LOC-${f.uniq()}`,
  ): Promise<Conn> {
    const secret = `secret-${f.uniq()}-abcdefgh`;
    const created = await r()
      .post('/channels/connections')
      .set(h(shop))
      .send({
        outletId,
        provider: STUB_PROVIDER,
        externalLocationId: locationId,
        credentials: { token: `tok-${f.uniq()}` },
        webhookSecret: secret,
      })
      .expect(201);
    const id = body<{ id: number }>(created).id;
    // Platform staff confirm the location with the marketplace first.
    await staffVerify(shop, id, { externalLocationId: locationId }).expect(201);
    await r()
      .post(`/channels/connections/${id}/enabled`)
      .set(h(shop))
      .send({ enabled: true })
      .expect(201);
    return { shop, id, locationId, secret, outletId };
  }

  // The platform-admin tier: only staff can record that a location is the
  // shop's. The tuple is what staff say they confirmed with the marketplace.
  function staffVerify(
    shop: W5Shop,
    connectionId: number,
    t: {
      externalLocationId: string;
      externalBrandId?: string | null;
      externalSiteId?: string | null;
    },
    auth = platform,
  ) {
    return r()
      .post(
        `/platform-admin/shops/${shop.shopId}/channel-connections/${connectionId}/verify-location`,
      )
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({ externalBrandId: null, externalSiteId: null, ...t });
  }

  function canon(
    lines: { id: string; qty?: number; priceMinor: number; name?: string }[],
    over: Partial<CanonicalChannelOrder> = {},
    totals: Partial<CanonicalChannelOrder['totals']> = {},
  ): CanonicalChannelOrder {
    const sum = lines.reduce((t, l) => t + l.priceMinor * (l.qty ?? 1), 0);
    return {
      externalOrderId: ext(),
      displayId: `D${seq}`,
      externalStatus: 'placed',
      placedAt: new Date().toISOString(),
      acceptBy: new Date(Date.now() + 7 * 60_000).toISOString(),
      scheduledFor: null,
      currency: 'AED',
      handover: 'marketplace_courier',
      lines: lines.map((l) => ({
        externalItemId: l.id,
        name: l.name ?? `Item ${l.id}`,
        quantity: l.qty ?? 1,
        unitPriceMinor: l.priceMinor,
        discountMinor: null,
        taxMinor: null,
        note: null,
      })),
      totals: {
        subtotalMinor: sum,
        deliveryFeeMinor: null,
        discountMinor: null,
        taxMinor: null,
        commissionMinor: null,
        totalMinor: sum,
        cashDueMinor: null,
        ...totals,
      },
      customer: { name: 'Sam K', phone: null, address: null, notes: null },
      ...over,
    };
  }

  let evSeq = 0;
  function deliver(
    c: Conn,
    payload: Record<string, unknown>,
    opts: {
      eventId?: string;
      secret?: string;
      inline?: boolean;
      location?: string;
    } = {},
  ) {
    const raw = JSON.stringify({
      locationId: opts.location ?? c.locationId,
      ...payload,
    });
    const eventId = opts.eventId ?? `ev-${f.runId}-${++evSeq}`;
    return ingestion.receive({
      provider: STUB_PROVIDER,
      rawBody: Buffer.from(raw),
      headers: {
        'x-stub-event-id': eventId,
        'x-stub-signature': signStubDelivery(
          opts.secret ?? c.secret,
          eventId,
          raw,
        ),
      },
      processInline: opts.inline ?? true,
    });
  }
  const newOrder = (c: Conn, o: CanonicalChannelOrder, opts = {}) =>
    deliver(c, { type: 'order.new', order: o }, opts);
  const statusEvent = (
    c: Conn,
    externalOrderId: string,
    status: string,
    opts = {},
  ) => deliver(c, { type: 'order.status', externalOrderId, status }, opts);

  async function link(c: Conn, externalOrderId: string) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
      [c.id, externalOrderId],
    );
    return rows[0];
  }

  async function mapItem(
    shop: W5Shop,
    externalItemId: string,
    productId: number,
    variantId?: number,
  ) {
    return r()
      .post('/channels/mappings')
      .set(h(shop))
      .send({ provider: STUB_PROVIDER, externalItemId, productId, variantId });
  }

  async function jobsOf(shopId: number, type: string, like = '%') {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM job WHERE shopId = ? AND type = ? AND idempotencyKey LIKE ?`,
      [shopId, type, like],
    );
  }

  // The order is already confirmed once accepted: walk the rest of the line.
  async function walkToDelivered(orderId: number) {
    for (const st of ['preparing', 'out_for_delivery', 'delivered']) {
      await f.setStatus(a, orderId, st);
    }
  }

  async function product(shop: W5Shop, stock: number, price = 25) {
    return f.stockedProduct(shop, stock, { price });
  }

  beforeAll(async () => {
    const booted = await bootApp();
    app = booted.app;
    db = booted.db;
    f = makeFixtures(app, db);
    ingestion = app.get(ChannelIngestionService);
    sweep = app.get(ChannelSweepService);
    stub = app.get(StubChannelProvider);
    const email = `mkt-staff-${f.runId}@test.com`;
    await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [email, await bcrypt.hash('platform-password-123', 10), 'Mkt Staff'],
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
      id: (
        await db.query<RowDataPacket[]>(
          `SELECT id FROM platformadmin WHERE email = ?`,
          [email],
        )
      )[0].id as number,
    };
    a = await f.setupShop('mkt-a');
    b = await f.setupShop('mkt-b');
    await grantFlag(a);
    await grantFlag(b);
    // A phone for the merchant alert (platform WhatsApp goes to the outlet).
    await db.execute(
      `UPDATE outlet SET whatsapp = '+971501112233' WHERE id IN (?, ?)`,
      [a.outletId, b.outletId],
    );
    ca = await connect(a);
    cb = await connect(b);
  });
  beforeEach(() => stub.reset());
  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('ships disabled', () => {
    it('without the platform flag a shop cannot create or enable a connection, and the list is empty', async () => {
      const c = await f.setupShop('mkt-off');
      await r().get('/channels/connections').set(h(c)).expect(200).expect([]);
      await r()
        .post('/channels/connections')
        .set(h(c))
        .send({ outletId: c.outletId, provider: STUB_PROVIDER })
        .expect(403);
    });

    it('availability reports the flag and whether any connection exists, to the desk roles only, and providers describe their credential form', async () => {
      const c = await f.setupShop('mkt-avail');
      await r()
        .get('/channels/availability')
        .set(h(c))
        .expect(200)
        .expect({ enabled: false, hasConnections: false });
      await grantFlag(c);
      await r()
        .get('/channels/availability')
        .set(h(c))
        .expect(200)
        .expect({ enabled: true, hasConnections: false });
      const created = body<{ id: number }>(
        await r()
          .post('/channels/connections')
          .set(h(c))
          .send({ outletId: c.outletId, provider: STUB_PROVIDER })
          .expect(201),
      );
      // Flag off again: an existing connection is still reported (it keeps
      // receiving orders), and nothing about another shop leaks in.
      await grantFlag(c, false);
      await r()
        .get('/channels/availability')
        .set(h(c))
        .expect(200)
        .expect({ enabled: false, hasConnections: true });
      // Flag off means no outbound marketplace call, not even a test.
      stub.calls.length = 0;
      await r()
        .post(`/channels/connections/${created.id}/test`)
        .set(h(c))
        .expect(403);
      expect(stub.calls).toEqual([]);
      // Another shop with no connection never inherits this shop's answer.
      const other = await f.setupShop('mkt-avail2');
      await r()
        .get('/channels/availability')
        .set(h(other))
        .expect(200)
        .expect({ enabled: false, hasConnections: false });
      const branch = await createStaff(
        app,
        c.adminToken,
        'av',
        'branch',
        c.outletId,
      );
      await r()
        .get('/channels/availability')
        .set({ Authorization: `Bearer ${branch.token}` })
        .expect(200)
        .expect({ enabled: false, hasConnections: true });
      const om = await createStaff(app, c.adminToken, 'av', 'order_manager');
      await r()
        .get('/channels/availability')
        .set({ Authorization: `Bearer ${om.token}` })
        .expect(200);
      const viewer = await createStaff(app, c.adminToken, 'av', 'viewer');
      await r()
        .get('/channels/availability')
        .set({ Authorization: `Bearer ${viewer.token}` })
        .expect(403);
      const providers = body<
        {
          name: string;
          displayName: string;
          credentialFields: { key: string; label: string }[];
        }[]
      >(await r().get('/channels/providers').set(h(c)).expect(200));
      const stubRow = providers.find((p) => p.name === STUB_PROVIDER);
      expect(stubRow?.displayName).toBeTruthy();
      expect(stubRow?.credentialFields.map((x) => x.key)).toEqual([
        'clientId',
        'clientSecret',
      ]);
    });

    it('a new connection is OFF, enabling needs ids + credentials, and no secret is ever returned', async () => {
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-off ${f.runId}` })
          .expect(201),
      );
      const secret = 'top-secret-value-1234';
      const res = await r()
        .post('/channels/connections')
        .set(h(a))
        .send({
          outletId: o2.id,
          provider: STUB_PROVIDER,
          credentials: { token: 'super-token-xyz' },
          webhookSecret: secret,
        })
        .expect(201);
      expect(res.body.enabled).toBe(false);
      expect(res.body.hasCredentials).toBe(true);
      expect(res.body.hasWebhookSecret).toBe(true);
      const dump = JSON.stringify([
        res.body,
        (await r().get('/channels/connections').set(h(a))).body,
      ]);
      expect(dump).not.toContain('super-token-xyz');
      expect(dump).not.toContain(secret);
      // No location id yet.
      await r()
        .post(`/channels/connections/${res.body.id}/enabled`)
        .set(h(a))
        .send({ enabled: true })
        .expect(400);
      // Stored encrypted, not plaintext.
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT credentials, webhookSecret FROM channelconnection WHERE id = ?`,
        [res.body.id],
      );
      expect(row.credentials).not.toContain('super-token-xyz');
      expect(row.webhookSecret).not.toContain(secret);
    });

    it('a failing connection test blocks enabling', async () => {
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-t ${f.runId}` })
          .expect(201),
      );
      const created = await r()
        .post('/channels/connections')
        .set(h(a))
        .send({
          outletId: o2.id,
          provider: STUB_PROVIDER,
          externalLocationId: `LOC-bad-${f.uniq()}`,
          credentials: { token: 'x' },
          webhookSecret: 'abcdefgh-secret',
        })
        .expect(201);
      stub.merchantBoundProof = true;
      stub.testConnectionOk = false;
      await r()
        .post(`/channels/connections/${created.body.id}/enabled`)
        .set(h(a))
        .send({ enabled: true })
        .expect(400);
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT enabled FROM channelconnection WHERE id = ?`,
        [created.body.id],
      );
      expect(row.enabled).toBe(false);
    });

    it('an unregistered provider cannot be connected', async () => {
      await r()
        .post('/channels/connections')
        .set(h(a))
        .send({ outletId: a.outletId, provider: 'unregistered_marketplace' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('tenant isolation (security-critical)', () => {
    const reject = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        const ex = e as { getStatus: () => number; getResponse: () => unknown };
        return { status: ex.getStatus(), response: ex.getResponse() };
      }
      throw new Error('expected a rejection');
    };

    it('unknown location, wrong secret, other tenant secret, disabled connection and garbage all get the SAME response and write nothing', async () => {
      const before = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM channelinboundevent WHERE provider = 'stub_marketplace'`,
      );
      const order = canon([{ id: 'i', priceMinor: 100 }]);
      const payload = { type: 'order.new', order };
      const results = [
        // unknown location, correct-looking signature
        await reject(deliver(ca, payload, { location: 'NO-SUCH-LOC' })),
        // known location, wrong secret
        await reject(
          deliver(ca, payload, { secret: 'a-completely-wrong-secret' }),
        ),
        // B's secret on A's location, and A's on B's
        await reject(deliver(ca, payload, { secret: cb.secret })),
        await reject(deliver(cb, payload, { secret: ca.secret })),
        // garbage bytes
        await reject(
          ingestion.receive({
            provider: STUB_PROVIDER,
            rawBody: Buffer.from('not json'),
            headers: {},
            processInline: true,
          }),
        ),
        // missing headers
        await reject(
          ingestion.receive({
            provider: STUB_PROVIDER,
            rawBody: Buffer.from(JSON.stringify({ locationId: ca.locationId })),
            headers: {},
            processInline: true,
          }),
        ),
        // unknown provider
        await reject(
          ingestion.receive({
            provider: 'nope',
            rawBody: Buffer.from('{}'),
            headers: {},
            processInline: true,
          }),
        ),
      ];
      for (const x of results) {
        expect(x.status).toBe(401);
        expect(x).toEqual(results[0]);
      }
      // A disabled connection looks exactly like an unknown one.
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-dis ${f.runId}` })
          .expect(201),
      );
      const dis = await connect(a, o2.id);
      await r()
        .post(`/channels/connections/${dis.id}/enabled`)
        .set(h(a))
        .send({ enabled: false })
        .expect(201);
      const d = await reject(deliver(dis, payload));
      expect(d).toEqual(results[0]);
      const after = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM channelinboundevent WHERE provider = 'stub_marketplace'`,
      );
      expect(Number(after[0].n)).toBe(Number(before[0].n));
    });

    it('a delivery for vendor X only creates orders in X shop, even when both shops get the same external order id', async () => {
      const pa = await product(a, 10);
      const pb = await product(b, 10);
      await mapItem(a, 'shared-sku', pa.id).then((x) =>
        expect(x.status).toBe(201),
      );
      await mapItem(b, 'shared-sku', pb.id).then((x) =>
        expect(x.status).toBe(201),
      );
      const o = canon([{ id: 'shared-sku', priceMinor: 2500 }], {
        externalOrderId: `SAME-${f.runId}`,
      });
      await newOrder(ca, o);
      await newOrder(cb, o);
      const la = await link(ca, o.externalOrderId);
      const lb = await link(cb, o.externalOrderId);
      expect(la.shopId).toBe(a.shopId);
      expect(lb.shopId).toBe(b.shopId);
      expect(la.orderId).not.toBe(lb.orderId);
      expect((await f.orderRow(la.orderId)).shopId).toBe(a.shopId);
      expect((await f.orderRow(lb.orderId)).shopId).toBe(b.shopId);
      // Each decremented only its own product.
      expect(await f.productStock(a.outletId, pa.id)).toBe(9);
      expect(await f.productStock(b.outletId, pb.id)).toBe(9);
    });

    it('B cannot claim A location id (409, generic), and cannot see or act on A channel orders', async () => {
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(b))
          .send({ name: `B2 ${f.runId}` })
          .expect(201),
      );
      const created = await r()
        .post('/channels/connections')
        .set(h(b))
        .send({
          outletId: o2.id,
          provider: STUB_PROVIDER,
          externalLocationId: ca.locationId,
          credentials: { token: 'x' },
          webhookSecret: 'abcdefgh-secret',
        })
        .expect(201);
      // Even a staff-verified duplicate cannot be enabled: one enabled
      // connection per location, platform-wide.
      await staffVerify(b, created.body.id, {
        externalLocationId: ca.locationId,
      }).expect(201);
      const res = await r()
        .post(`/channels/connections/${created.body.id}/enabled`)
        .set(h(b))
        .send({ enabled: true })
        .expect(409);
      expect(JSON.stringify(res.body)).not.toContain(String(a.shopId));

      const p = await product(a, 5);
      await mapItem(a, 'iso-sku', p.id);
      const o = canon([{ id: 'iso-sku', priceMinor: 2500 }]);
      await newOrder(ca, o);
      const la = await link(ca, o.externalOrderId);
      const list = await r().get('/channels/orders').set(h(b)).expect(200);
      expect(list.body.data.some((x: { id: number }) => x.id === la.id)).toBe(
        false,
      );
      await r().post(`/channels/orders/${la.id}/accept`).set(h(b)).expect(404);
      await r()
        .post(`/channels/orders/${la.id}/reject`)
        .set(h(b))
        .send({})
        .expect(404);
      // Mappings and the unmapped queue are per shop too.
      const mb = await r().get('/channels/mappings').set(h(b)).expect(200);
      expect(JSON.stringify(mb.body)).not.toContain('iso-sku');
      await r().delete(`/channels/connections/${ca.id}`).set(h(b)).expect(404);
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(b))
        .send({ externalLocationId: 'hijack' })
        .expect(404);
    });

    it('a status event for A cannot touch B order with the same external id', async () => {
      const pa = await product(a, 5);
      const pb = await product(b, 5);
      await mapItem(a, 'st-sku', pa.id);
      await mapItem(b, 'st-sku', pb.id);
      const o = canon([{ id: 'st-sku', priceMinor: 2500 }]);
      await newOrder(ca, o);
      await newOrder(cb, o);
      await statusEvent(ca, o.externalOrderId, 'cancelled');
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'cancelled_upstream',
      );
      expect((await link(cb, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
      expect(await f.productStock(b.outletId, pb.id)).toBe(4);
      expect(await f.productStock(a.outletId, pa.id)).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  describe('order creation', () => {
    it('creates the order with the marketplace as channel and payment method, no charge, no customer row, minimal data', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'sku-1', p.id);
      const customersBefore = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customer WHERE shopId = ?`,
        [a.shopId],
      );
      const o = canon([{ id: 'sku-1', qty: 2, priceMinor: 2500 }]);
      const res = await newOrder(ca, o);
      expect(res.duplicate).toBe(false);
      const co = await link(ca, o.externalOrderId);
      expect(co.state).toBe('pending_acceptance');
      const order = await f.orderRow(co.orderId);
      expect(order.channel).toBe(STUB_PROVIDER);
      expect(order.paymentMethod).toBe(STUB_PROVIDER);
      expect(order.paymentStatus).toBe('paid');
      expect(order.status).toBe('pending');
      expect(order.orderType).toBe('pickup');
      expect(order.customerId).toBeNull();
      expect(order.customerEmail).toBeNull();
      expect(order.customerPhone).toBe('');
      expect(order.customerAddress).toBe('');
      expect(order.trackingToken).toBeNull();
      expect(order.paymentSessionId).toBeNull();
      expect(order.paymentLinkToken).toBeNull();
      expect(Number(order.total)).toBe(50);
      // tax and commission were not in the payload: NULL, never 0.
      expect(order.taxAmount).toBeNull();
      expect(co.commissionAmount).toBeNull();
      const items = await f.orderItems(co.orderId);
      expect(items).toHaveLength(1);
      expect(Number(items[0].priceAtPurchase)).toBe(25);
      expect(items[0].taxAmount).toBeNull();
      expect(items[0].taxRate).toBeNull();
      expect(items[0].taxClassId).toBeNull();
      const tx = await db.query<RowDataPacket[]>(
        `SELECT 1 FROM paymenttransaction WHERE orderId = ?`,
        [co.orderId],
      );
      expect(tx).toHaveLength(0);
      const customersAfter = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM customer WHERE shopId = ?`,
        [a.shopId],
      );
      expect(customersAfter[0].n).toBe(customersBefore[0].n);
      // The canonical snapshot (customer details) is dropped once the order exists.
      expect(co.canonical).toBeNull();
    });

    it('takes tax, commission and a three-decimal currency from the payload exactly', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'kwd-sku', p.id);
      const o = canon(
        [{ id: 'kwd-sku', qty: 3, priceMinor: 10505 }],
        { currency: 'KWD' },
        {
          taxMinor: 1576,
          commissionMinor: 4727,
          deliveryFeeMinor: 500,
          discountMinor: 250,
          totalMinor: 31515 + 500 - 250 + 1576,
        },
      );
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      const order = await f.orderRow(co.orderId);
      expect(order.currency).toBe('KWD');
      expect(order.taxAmount).toMatch(/^1\.576/);
      expect(order.deliveryFee).toMatch(/^0\.500/);
      expect(order.discountAmount).toMatch(/^0\.250/);
      expect(Number(order.total)).toBeCloseTo(33.341, 3);
      expect(co.commissionAmount).toBe('4.727');
      expect((await f.orderItems(co.orderId))[0].priceAtPurchase).toMatch(
        /^10\.505/,
      );
    });

    it('uses per-shop order numbers, independent between shops', async () => {
      const p = await product(a, 20);
      const q = await product(b, 20);
      await mapItem(a, 'num-sku', p.id);
      await mapItem(b, 'num-sku', q.id);
      const nums: number[] = [];
      for (let i = 0; i < 3; i++) {
        const o = canon([{ id: 'num-sku', priceMinor: 1000 }]);
        await newOrder(ca, o);
        nums.push(
          (await f.orderRow((await link(ca, o.externalOrderId)).orderId))
            .shopOrderNumber,
        );
      }
      expect(nums[1]).toBe(nums[0] + 1);
      expect(nums[2]).toBe(nums[1] + 1);
      const ob = canon([{ id: 'num-sku', priceMinor: 1000 }]);
      await newOrder(cb, ob);
      const nb = (
        await f.orderRow((await link(cb, ob.externalOrderId)).orderId)
      ).shopOrderNumber;
      const [maxB] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM \`order\` WHERE shopId = ?`,
        [b.shopId],
      );
      expect(nb).toBe(Number(maxB.n));
    });

    it('a merchant-delivery order is a delivery, a pickup is a pickup', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'ot-sku', p.id);
      const o1 = canon([{ id: 'ot-sku', priceMinor: 1000 }], {
        handover: 'merchant_delivery',
      });
      const o2 = canon([{ id: 'ot-sku', priceMinor: 1000 }], {
        handover: 'customer_pickup',
      });
      await newOrder(ca, o1);
      await newOrder(ca, o2);
      expect(
        (await f.orderRow((await link(ca, o1.externalOrderId)).orderId))
          .orderType,
      ).toBe('delivery');
      expect(
        (await f.orderRow((await link(ca, o2.externalOrderId)).orderId))
          .orderType,
      ).toBe('pickup');
    });

    it('a cash-due order stays unpaid', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'cash-sku', p.id);
      const o = canon(
        [{ id: 'cash-sku', priceMinor: 1000 }],
        {},
        { cashDueMinor: 1000 },
      );
      await newOrder(ca, o);
      expect(
        (await f.orderRow((await link(ca, o.externalOrderId)).orderId))
          .paymentStatus,
      ).toBe('unpaid');
    });

    it('holds stock from arrival, never refuses on stock, and keeps the ledger conserved', async () => {
      const p = await product(a, 1);
      await mapItem(a, 'low-sku', p.id);
      const o = canon([{ id: 'low-sku', qty: 3, priceMinor: 1000 }]);
      await newOrder(ca, o);
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
      const ing = (await f.shadowIngredientId(p.id))!;
      expect(await f.stockOf(a.outletId, ing)).toBe(-2);
      expect(await f.ledgerSum(a.outletId, ing)).toBe(-2 + 0);
    });

    it('rejects a canonical order with a wrong figure into the dead letter, writing no order', async () => {
      const bad = canon([{ id: 'x', priceMinor: 100 }]);
      (bad.lines[0] as { unitPriceMinor: number }).unitPriceMinor = 10.5;
      const res = await newOrder(ca, bad);
      const [ev] = await db.query<RowDataPacket[]>(
        `SELECT status, lastError FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(ev.status).toBe('dead');
      expect(await link(ca, bad.externalOrderId)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('idempotency', () => {
    it('the same delivery twice is one inbox row, one order, one stock decrement', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'dup-sku', p.id);
      const o = canon([{ id: 'dup-sku', priceMinor: 1000 }]);
      const first = await newOrder(ca, o, { eventId: `same-${f.uniq()}` });
      const second = await deliver(
        ca,
        { type: 'order.new', order: o },
        {
          eventId: (
            await db.query<RowDataPacket[]>(
              `SELECT eventId FROM channelinboundevent WHERE id = ?`,
              [first.inboxId],
            )
          )[0].eventId,
        },
      );
      expect(second.duplicate).toBe(true);
      expect(second.inboxId).toBe(first.inboxId);
      expect(await f.productStock(a.outletId, p.id)).toBe(9);
    });

    it('a redelivery with a NEW delivery id is still one order', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'dup2-sku', p.id);
      const o = canon([{ id: 'dup2-sku', priceMinor: 1000 }]);
      await newOrder(ca, o);
      await newOrder(ca, o);
      await newOrder(ca, o);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT id FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
        [ca.id, o.externalOrderId],
      );
      expect(rows).toHaveLength(1);
      const orders = await db.query<RowDataPacket[]>(
        `SELECT id FROM \`order\` WHERE id = ?`,
        [rows.length ? (await link(ca, o.externalOrderId)).orderId : 0],
      );
      expect(orders).toHaveLength(1);
      expect(await f.productStock(a.outletId, p.id)).toBe(9);
    });

    it('concurrent duplicate deliveries (same and different delivery ids) create exactly one order', async () => {
      const p = await product(a, 20);
      await mapItem(a, 'conc-sku', p.id);
      const o = canon([{ id: 'conc-sku', priceMinor: 1000 }]);
      const sameId = `conc-${f.uniq()}`;
      await Promise.all([
        ...Array.from({ length: 4 }, () =>
          newOrder(ca, o, { eventId: sameId }),
        ),
        ...Array.from({ length: 4 }, () => newOrder(ca, o)),
      ]);
      const links = await db.query<RowDataPacket[]>(
        `SELECT id, orderId FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
        [ca.id, o.externalOrderId],
      );
      expect(links).toHaveLength(1);
      const orders = await db.query<RowDataPacket[]>(
        `SELECT id FROM \`order\` WHERE id = ?`,
        [links[0].orderId],
      );
      expect(orders).toHaveLength(1);
      const sameRows = await db.query<RowDataPacket[]>(
        `SELECT id FROM channelinboundevent WHERE connectionId = ? AND eventId = ?`,
        [ca.id, sameId],
      );
      expect(sameRows).toHaveLength(1);
      expect(await f.productStock(a.outletId, p.id)).toBe(19);
      const ing = (await f.shadowIngredientId(p.id))!;
      expect(await f.ledgerSum(a.outletId, ing)).toBe(
        await f.stockOf(a.outletId, ing),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('unmapped items', () => {
    it('waits as needs_mapping with no order, is listed, alerts the merchant, then becomes an order when mapped', async () => {
      const p1 = await product(a, 10);
      const p2 = await product(a, 10, 40);
      const sku1 = `um1-${f.uniq()}`;
      const sku2 = `um2-${f.uniq()}`;
      await mapItem(a, sku1, p1.id);
      const o = canon([
        { id: sku1, priceMinor: 2500 },
        { id: sku2, priceMinor: 4000, name: 'Mystery bouquet' },
      ]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      expect(co.state).toBe('needs_mapping');
      expect(co.orderId).toBeNull();
      // Nothing was created or consumed.
      expect(await f.productStock(a.outletId, p1.id)).toBe(10);
      // Visible to the merchant.
      const list = await r()
        .get('/channels/orders?state=needs_mapping')
        .set(h(a))
        .expect(200);
      const row = list.body.data.find((x: { id: number }) => x.id === co.id);
      expect(row.state).toBe('needs_mapping');
      expect(row.waitingItems.map((w: { name: string }) => w.name)).toContain(
        'Mystery bouquet',
      );
      expect(JSON.stringify(row)).not.toContain('Sam K');
      const queue = await r()
        .get('/channels/unmapped-items')
        .set(h(a))
        .expect(200);
      const item = queue.body.find(
        (x: { externalItemId: string }) => x.externalItemId === sku2,
      );
      expect(
        item.waitingOrders.map(
          (w: { channelOrderId: number }) => w.channelOrderId,
        ),
      ).toContain(co.id);
      // Merchant alert queued (once) through the existing job queue.
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co.id}:alert`,
        ),
      ).toHaveLength(1);
      // Never auto-created as a product.
      const created = await db.query<RowDataPacket[]>(
        `SELECT id FROM product WHERE shopId = ? AND name = 'Mystery bouquet'`,
        [a.shopId],
      );
      expect(created).toHaveLength(0);

      // Another shop's product cannot resolve it.
      const foreign = await product(b, 1);
      await r()
        .post(`/channels/unmapped-items/${item.id}/resolve`)
        .set(h(a))
        .send({ productId: foreign.id })
        .expect(400);
      expect((await link(ca, o.externalOrderId)).state).toBe('needs_mapping');

      const resolved = await r()
        .post(`/channels/unmapped-items/${item.id}/resolve`)
        .set(h(a))
        .send({ productId: p2.id })
        .expect(201);
      expect(resolved.body.ordersCreated).toBe(1);
      const after = await link(ca, o.externalOrderId);
      expect(after.state).toBe('pending_acceptance');
      const order = await f.orderRow(after.orderId);
      expect(Number(order.total)).toBe(65);
      expect(await f.productStock(a.outletId, p1.id)).toBe(9);
      expect(await f.productStock(a.outletId, p2.id)).toBe(9);
      const q2 = await r()
        .get('/channels/unmapped-items')
        .set(h(a))
        .expect(200);
      expect(
        q2.body.find(
          (x: { externalItemId: string }) => x.externalItemId === sku2,
        ),
      ).toBeUndefined();
    });

    it('an order that is cancelled upstream while waiting closes without ever making an order', async () => {
      const o = canon([{ id: `never-${f.uniq()}`, priceMinor: 1000 }]);
      await newOrder(ca, o);
      await statusEvent(ca, o.externalOrderId, 'cancelled');
      const co = await link(ca, o.externalOrderId);
      expect(co.state).toBe('cancelled_upstream');
      expect(co.orderId).toBeNull();
    });

    it('a mapping to a product with options needs a variant, and a gift card is refused', async () => {
      const p = await product(a, 5);
      await f.addVariants(a, p.id, ['S', 'M']);
      await mapItem(a, `var-${f.uniq()}`, p.id).then((x) =>
        expect(x.status).toBe(400),
      );
      const gift = await r()
        .post('/products')
        .set(h(a))
        .send({
          name: `Gift ${f.uniq()}`,
          price: 50,
          thumbnail: 'https://example.com/t.jpg',
          sku: `G-${f.uniq()}`,
          isGiftCard: true,
          collectionIds: [a.collectionId],
        });
      if (gift.status === 201) {
        await mapItem(a, `gift-${f.uniq()}`, gift.body.id).then((x) =>
          expect(x.status).toBe(400),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('price mismatch', () => {
    it('keeps the payload price on the order and flags the difference', async () => {
      const p = await product(a, 10, 25);
      await mapItem(a, 'pm-sku', p.id);
      const o = canon([{ id: 'pm-sku', priceMinor: 3000 }]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      expect(Number((await f.orderItems(co.orderId))[0].priceAtPurchase)).toBe(
        30,
      );
      expect(co.priceMismatch).toEqual([
        expect.objectContaining({
          externalItemId: 'pm-sku',
          payloadMinor: 3000,
          catalogMinor: 2500,
        }),
      ]);
      const list = await r().get('/channels/orders').set(h(a)).expect(200);
      expect(
        list.body.data.find((x: { id: number }) => x.id === co.id)
          .priceMismatch,
      ).toHaveLength(1);

      const same = canon([{ id: 'pm-sku', priceMinor: 2500 }]);
      await newOrder(ca, same);
      expect((await link(ca, same.externalOrderId)).priceMismatch).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('accept, reject and upstream cancellation', () => {
    async function fresh(stock = 10) {
      const p = await product(a, stock);
      const sku = `ac-${f.uniq()}`;
      await mapItem(a, sku, p.id);
      const o = canon([{ id: sku, qty: 2, priceMinor: 2500 }]);
      await newOrder(ca, o);
      return {
        p,
        o,
        co: await link(ca, o.externalOrderId),
        ing: (await f.shadowIngredientId(p.id))!,
      };
    }

    it('accepting confirms the order without taking stock twice; repeating is a no-op', async () => {
      const { p, o, co } = await fresh();
      expect(await f.productStock(a.outletId, p.id)).toBe(8);
      const res = await r()
        .post(`/channels/orders/${co.id}/accept`)
        .set(h(a))
        .expect(201);
      expect(res.body.state).toBe('accepted');
      expect((await f.orderRow(co.orderId)).status).toBe('confirmed');
      expect(await f.productStock(a.outletId, p.id)).toBe(8);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect(
        stub.calls.filter(
          (c) =>
            c.method === 'acceptOrder' &&
            c.externalOrderId === o.externalOrderId,
        ),
      ).toHaveLength(1);
    });

    it('a failing marketplace call changes nothing and can be retried', async () => {
      const { co } = await fresh();
      stub.failNext.add('acceptOrder');
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(502);
      expect(
        (
          await db.query<RowDataPacket[]>(
            `SELECT state FROM channelorder WHERE id = ?`,
            [co.id],
          )
        )[0].state,
      ).toBe('pending_acceptance');
      expect((await f.orderRow(co.orderId)).status).toBe('pending');
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect((await f.orderRow(co.orderId)).status).toBe('confirmed');
    });

    it('rejecting tells the marketplace, cancels the order and gives the stock back', async () => {
      const { p, o, co, ing } = await fresh();
      expect(await f.productStock(a.outletId, p.id)).toBe(8);
      await r()
        .post(`/channels/orders/${co.id}/reject`)
        .set(h(a))
        .send({ reason: 'busy' })
        .expect(201);
      expect(
        stub.calls.find(
          (c) =>
            c.method === 'rejectOrder' &&
            c.externalOrderId === o.externalOrderId,
        )?.detail,
      ).toEqual({ reason: 'busy' });
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
      expect(await f.ledgerSum(a.outletId, ing)).toBe(
        await f.stockOf(a.outletId, ing),
      );
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(409);
    });

    it('upstream cancellation after acceptance cancels the order through the normal path and restocks', async () => {
      const { p, o, co, ing } = await fresh();
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      await statusEvent(ca, o.externalOrderId, 'cancelled');
      const after = await link(ca, o.externalOrderId);
      expect(after.state).toBe('cancelled_upstream');
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      // F11/M2: the system cancel is attributed to the sync, not a real admin.
      const cancelRows = await db.query<RowDataPacket[]>(
        `SELECT actorUserId, actorLabel FROM auditlog
         WHERE shopId = ? AND entityType = 'order' AND entityId = ? AND action = 'order.status_changed'
           AND JSON_UNQUOTE(JSON_EXTRACT(\`after\`, '$.status')) = 'cancelled'`,
        [a.shopId, co.orderId],
      );
      expect(cancelRows).toHaveLength(1);
      expect(cancelRows[0].actorUserId).toBeNull();
      expect(cancelRows[0].actorLabel).toBe('system (channel sync)');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
      expect(await f.ledgerSum(a.outletId, ing)).toBe(
        await f.stockOf(a.outletId, ing),
      );
      // A duplicate cancel (new delivery id) restocks nothing more.
      await statusEvent(ca, o.externalOrderId, 'cancelled');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
    });

    it('upstream cancellation while still pending restocks too, and "rejected" (auto-reject) closes it', async () => {
      const x = await fresh();
      await statusEvent(ca, x.o.externalOrderId, 'cancelled');
      expect(await f.productStock(a.outletId, x.p.id)).toBe(10);
      const y = await fresh();
      await statusEvent(ca, y.o.externalOrderId, 'rejected');
      expect((await link(ca, y.o.externalOrderId)).state).toBe('rejected');
      expect((await f.orderRow(y.co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(a.outletId, y.p.id)).toBe(10);
    });

    it('a marketplace-side acceptance (tablet) confirms our order', async () => {
      const { o, co } = await fresh();
      await statusEvent(ca, o.externalOrderId, 'accepted');
      expect((await link(ca, o.externalOrderId)).state).toBe('accepted');
      expect((await f.orderRow(co.orderId)).status).toBe('confirmed');
    });

    it('an order the kitchen already delivered is not un-delivered, but the cancellation is visible', async () => {
      const { o, co } = await fresh();
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      await walkToDelivered(co.orderId);
      await statusEvent(ca, o.externalOrderId, 'cancelled');
      const after = await link(ca, o.externalOrderId);
      expect(after.state).toBe('cancelled_upstream');
      expect(after.lastError).toMatch(/delivered/i);
      expect((await f.orderRow(co.orderId)).status).toBe('delivered');
    });

    it('accept racing an upstream rejection ends consistent', async () => {
      for (let i = 0; i < 3; i++) {
        const { p, o, co } = await fresh();
        await Promise.allSettled([
          r().post(`/channels/orders/${co.id}/accept`).set(h(a)),
          statusEvent(ca, o.externalOrderId, 'rejected'),
        ]);
        const state = (await link(ca, o.externalOrderId)).state;
        const status = (await f.orderRow(co.orderId)).status;
        if (state === 'rejected') {
          expect(status).toBe('cancelled');
          expect(await f.productStock(a.outletId, p.id)).toBe(10);
        } else {
          expect(state).toBe('accepted');
          expect(['confirmed', 'cancelled']).toContain(status);
        }
      }
    });

    it('a status event that beats order.new is retried from the inbox, never dropped', async () => {
      const p = await product(a, 5);
      const sku = `oo-${f.uniq()}`;
      await mapItem(a, sku, p.id);
      const o = canon([{ id: sku, priceMinor: 1000 }]);
      const early = await statusEvent(ca, o.externalOrderId, 'cancelled');
      let ev = (
        await db.query<RowDataPacket[]>(
          `SELECT status FROM channelinboundevent WHERE id = ?`,
          [early.inboxId],
        )
      )[0];
      expect(ev.status).toBe('failed');
      await newOrder(ca, o);
      await db.execute(
        `UPDATE channelinboundevent SET nextAttemptAt = ? WHERE id = ?`,
        [new Date(Date.now() - 1000), early.inboxId],
      );
      await sweep.replayDue();
      ev = (
        await db.query<RowDataPacket[]>(
          `SELECT status FROM channelinboundevent WHERE id = ?`,
          [early.inboxId],
        )
      )[0];
      expect(ev.status).toBe('processed');
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'cancelled_upstream',
      );
    });

    it('branch users see only their outlet, and a restricted role cannot accept', async () => {
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-br ${f.runId}` })
          .expect(201),
      );
      const c2 = await connect(a, o2.id);
      const p = await product(a, 10);
      await mapItem(a, 'br-sku', p.id);
      const ox = canon([{ id: 'br-sku', priceMinor: 1000 }]);
      const oy = canon([{ id: 'br-sku', priceMinor: 1000 }]);
      await newOrder(ca, ox);
      await newOrder(c2, oy);
      const staff = await createStaff(
        app,
        a.adminToken,
        'mk',
        'branch',
        a.outletId,
      );
      const bh = { Authorization: `Bearer ${staff.token}` };
      const list = await r().get('/channels/orders').set(bh).expect(200);
      const ids = list.body.data.map(
        (x: { externalOrderId: string }) => x.externalOrderId,
      );
      expect(ids).toContain(ox.externalOrderId);
      expect(ids).not.toContain(oy.externalOrderId);
      const other = await link(c2, oy.externalOrderId);
      await r().post(`/channels/orders/${other.id}/accept`).set(bh).expect(404);
      // Connection config is admin only.
      await r().get('/channels/connections').set(bh).expect(403);
      await r().get('/channels/mappings').set(bh).expect(403);

      const role = body<{ id: number }>(
        await r()
          .post('/shop/branch-roles')
          .set(h(a))
          .send({ name: `view-only-${f.uniq()}`, permissions: ['orders.view'] })
          .expect(201),
      );
      await r()
        .post('/shop/branch-roles/assignments')
        .set(h(a))
        .send({
          userId: staff.userId,
          outletId: a.outletId,
          branchRoleId: role.id,
        })
        .expect(201);
      const mine = await link(ca, ox.externalOrderId);
      await r().post(`/channels/orders/${mine.id}/accept`).set(bh).expect(403);
      await r().get('/channels/orders').set(bh).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('no customer messaging, no charge, no re-pricing', () => {
    it('never enqueues a customer email or WhatsApp, creates no survey, and refuses a payment link', async () => {
      await r()
        .patch('/shop')
        .set(h(a))
        .send({
          notifyEmail: true,
          notifyCustomersWhatsapp: true,
          customerSurveyEnabled: true,
        })
        .expect(200);
      const p = await product(a, 10);
      await mapItem(a, 'msg-sku', p.id);
      const o = canon([{ id: 'msg-sku', priceMinor: 1000 }]);
      const emailsBefore = await jobsOf(a.shopId, 'send_email');
      const wa = jest.spyOn(app.get(MetaWhatsAppProvider), 'sendMessage');
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      await walkToDelivered(co.orderId);
      expect(await jobsOf(a.shopId, 'send_email')).toHaveLength(
        emailsBefore.length,
      );
      expect(wa).not.toHaveBeenCalled();
      const survey = await db.query<RowDataPacket[]>(
        `SELECT 1 FROM surveyresponse WHERE orderId = ?`,
        [co.orderId],
      );
      expect(survey).toHaveLength(0);

      // The guard is in the notification service itself, not just in NULL data:
      // give the order a real address and call every customer-facing method.
      await db.execute(
        `UPDATE \`order\` SET customerEmail = 'sam@example.com', customerPhone = '0501234567' WHERE id = ?`,
        [co.orderId],
      );
      const order = await f.orderRow(co.orderId);
      const n = app.get(OrderNotificationsService);
      await n.notifyOrderConfirmed(a.shopId, order as never);
      await n.notifyOutForDelivery(a.shopId, order as never);
      await n.notifySurveyRequest(a.shopId, order as never);
      const sent = await n.sendDeliveryCode(
        a.shopId,
        order as never,
        '1234',
        `k-${co.orderId}`,
      );
      expect(sent).toEqual({ email: false, whatsapp: false });
      expect(await jobsOf(a.shopId, 'send_email')).toHaveLength(
        emailsBefore.length,
      );
      expect(wa).not.toHaveBeenCalled();
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `order:${co.orderId}:%`,
        ),
      ).toHaveLength(0);

      // Control: the same call for an ordinary order DOES queue an email, so the
      // assertions above could have failed.
      const normal = await f.adminOrder(a, [{ productId: p.id, quantity: 1 }], {
        customerEmail: 'real@example.com',
      });
      const normalRow = await f.orderRow(normal.id);
      await n.notifyOrderConfirmed(a.shopId, normalRow as never);
      expect((await jobsOf(a.shopId, 'send_email')).length).toBeGreaterThan(
        emailsBefore.length,
      );
      wa.mockRestore();

      // No gateway charge is possible.
      await r()
        .post(`/orders/${co.orderId}/payment-link`)
        .set(h(a))
        .expect(400);
      expect(
        await db.query<RowDataPacket[]>(
          `SELECT 1 FROM paymenttransaction WHERE orderId = ?`,
          [co.orderId],
        ),
      ).toHaveLength(0);
      await r()
        .patch('/shop')
        .set(h(a))
        .send({
          notifyEmail: false,
          notifyCustomersWhatsapp: false,
          customerSurveyEnabled: false,
        })
        .expect(200);
    });

    it('an UNPAID marketplace order (cash due) still cannot be charged through a gateway', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'cashlink-sku', p.id);
      const o = canon(
        [{ id: 'cashlink-sku', priceMinor: 1000 }],
        {},
        { cashDueMinor: 1000 },
      );
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      expect((await f.orderRow(co.orderId)).paymentStatus).toBe('unpaid');
      const res = await r()
        .post(`/orders/${co.orderId}/payment-link`)
        .set(h(a))
        .expect(400);
      expect(res.body.message).toMatch(/marketplace/i);
      // Even a link token that somehow exists is dead.
      await db.execute(
        `UPDATE \`order\` SET paymentLinkToken = ?, paymentLinkExpiresAt = ? WHERE id = ?`,
        [`tok-${f.uniq()}`, new Date(Date.now() + 3600_000), co.orderId],
      );
      const tok = (await f.orderRow(co.orderId)).paymentLinkToken as string;
      await r().get(`/pay/${tok}`).expect(404);
      expect(
        await db.query<RowDataPacket[]>(
          `SELECT 1 FROM paymenttransaction WHERE orderId = ?`,
          [co.orderId],
        ),
      ).toHaveLength(0);
    });

    it('the order cannot be re-priced locally', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'edit-sku', p.id);
      const o = canon([{ id: 'edit-sku', priceMinor: 1000 }]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      await f
        .editItems(a, co.orderId, [{ productId: p.id, quantity: 1 }])
        .expect(409);
      await r()
        .patch(`/orders/${co.orderId}/delivery-fee`)
        .set(h(a))
        .send({ deliveryFee: 5 })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('outage, replay and polling: accepted orders are never lost', () => {
    it('the delivery is durable before processing; a crash before processing is recovered by the sweep', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'dur-sku', p.id);
      const o = canon([{ id: 'dur-sku', priceMinor: 1000 }]);
      const spy = jest
        .spyOn(ingestion, 'processInboxEvent')
        .mockResolvedValue('skipped');
      const res = await newOrder(ca, o);
      spy.mockRestore();
      const [ev] = await db.query<RowDataPacket[]>(
        `SELECT status, signatureVerified, payload FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(ev.status).toBe('received');
      expect(ev.signatureVerified).toBe(true);
      expect(ev.payload.order.externalOrderId).toBe(o.externalOrderId);
      expect(await link(ca, o.externalOrderId)).toBeUndefined();
      expect(await sweep.replayDue()).toBeGreaterThan(0);
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
    });

    it('a processor that died holding the claim is reclaimed after the lock goes stale', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'lock-sku', p.id);
      const o = canon([{ id: 'lock-sku', priceMinor: 1000 }]);
      const spy = jest
        .spyOn(ingestion, 'processInboxEvent')
        .mockResolvedValue('skipped');
      const res = await newOrder(ca, o);
      spy.mockRestore();
      await db.execute(
        `UPDATE channelinboundevent SET status = 'processing', lockedAt = ? WHERE id = ?`,
        [new Date(Date.now() - 3600_000), res.inboxId],
      );
      await sweep.replayDue();
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
    });

    it('an unparseable but authentic payload is dead-lettered, kept, and replayable', async () => {
      const res = await deliver(ca, { type: 'order.new' });
      const [ev] = await db.query<RowDataPacket[]>(
        `SELECT status, payload, lastError FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(ev.status).toBe('dead');
      expect(ev.payload).not.toBeNull();
      const re = await r()
        .post('/channels/inbox/replay')
        .set(h(a))
        .send({ ids: [res.inboxId] })
        .expect(201);
      expect(re.body.requeued).toBe(1);
      // Another shop cannot replay it.
      expect(
        (
          await r()
            .post('/channels/inbox/replay')
            .set(h(b))
            .send({ ids: [res.inboxId] })
            .expect(201)
        ).body.requeued,
      ).toBe(0);
    });

    it('polling ingests orders the webhook never delivered, and a repeated poll adds nothing', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'poll-sku', p.id);
      const o = canon([{ id: 'poll-sku', priceMinor: 1000 }]);
      stub.openOrders.set(ca.locationId, [
        {
          eventId: `poll-${o.externalOrderId}`,
          payload: { type: 'order.new', locationId: ca.locationId, order: o },
        },
      ]);
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [ca.id],
      );
      await sweep.pollConnections();
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [ca.id],
      );
      await sweep.pollConnections();
      const n = await db.query<RowDataPacket[]>(
        `SELECT id FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
        [ca.id, o.externalOrderId],
      );
      expect(n).toHaveLength(1);
      expect(await f.productStock(a.outletId, p.id)).toBe(9);
      const [c] = await db.query<RowDataPacket[]>(
        `SELECT lastSyncStatus FROM channelconnection WHERE id = ?`,
        [ca.id],
      );
      expect(c.lastSyncStatus).toBe('ok');
    });

    it('past the acceptance deadline the merchant is alerted once; the marketplace answer settles it when it can', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'stale-sku', p.id);
      const o = canon([{ id: 'stale-sku', priceMinor: 1000 }]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      await db.execute(`UPDATE channelorder SET acceptBy = ? WHERE id = ?`, [
        new Date(Date.now() - 60_000),
        co.id,
      ]);
      const first = await sweep.staleOrders();
      expect(first.alerted).toBeGreaterThanOrEqual(1);
      const second = await sweep.staleOrders();
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co.id}:stale-alert`,
        ),
      ).toHaveLength(1);
      void second;

      const o2 = canon([{ id: 'stale-sku', priceMinor: 1000 }]);
      await newOrder(ca, o2);
      const co2 = await link(ca, o2.externalOrderId);
      await db.execute(`UPDATE channelorder SET acceptBy = ? WHERE id = ?`, [
        new Date(Date.now() - 60_000),
        co2.id,
      ]);
      stub.statuses.set(o2.externalOrderId, 'rejected');
      await sweep.staleOrders();
      expect((await link(ca, o2.externalOrderId)).state).toBe('rejected');
      expect((await f.orderRow(co2.orderId)).status).toBe('cancelled');
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co2.id}:stale-alert`,
        ),
      ).toHaveLength(0);
    });

    it('an order the marketplace accepted but we failed to confirm is repaired', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'rep-sku', p.id);
      const o = canon([{ id: 'rep-sku', priceMinor: 1000 }]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      await db.execute(
        `UPDATE channelorder SET state = 'accepted', updatedAt = ? WHERE id = ?`,
        [new Date(Date.now() - 3600_000), co.id],
      );
      const out = await sweep.staleOrders();
      expect(out.repaired).toBeGreaterThanOrEqual(1);
      expect((await f.orderRow(co.orderId)).status).toBe('confirmed');
    });

    it('an already-enabled connection keeps receiving orders when the platform flag is turned off', async () => {
      await grantFlag(b, false);
      const p = await product(b, 5);
      await mapItem(b, 'flag-sku', p.id).then((x) =>
        expect(x.status).toBe(201),
      );
      const o = canon([{ id: 'flag-sku', priceMinor: 1000 }]);
      await newOrder(cb, o);
      expect((await link(cb, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
      await r()
        .post('/channels/connections')
        .set(h(b))
        .send({ outletId: b.outletId, provider: STUB_PROVIDER })
        .expect(403);
      await grantFlag(b, true);
    });

    it('reports the ingestion SLO numbers', async () => {
      const s = await r()
        .get('/channels/stats?sinceMinutes=1440')
        .set(h(a))
        .expect(200);
      expect(s.body.processed).toBeGreaterThan(0);
      expect(s.body.ingestionSuccessPct).toBeGreaterThan(0);
      expect(s.body.ingestionSuccessPct).toBeLessThanOrEqual(100);
      expect(s.body.failurePct).toBeGreaterThanOrEqual(0);
      const empty = await f.setupShop('mkt-empty');
      await grantFlag(empty);
      const none = await r().get('/channels/stats').set(h(empty)).expect(200);
      expect(none.body.ingestionSuccessPct).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('housekeeping', () => {
    it('a connection with marketplace orders cannot be deleted, and neither can its outlet', async () => {
      await r().delete(`/channels/connections/${ca.id}`).set(h(a)).expect(409);
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-del ${f.runId}` })
          .expect(201),
      );
      const c = await connect(a, o2.id);
      await r().delete(`/outlets/${o2.id}`).set(h(a)).expect(409);
      // An enabled connection cannot be deleted at all.
      await r().delete(`/channels/connections/${c.id}`).set(h(a)).expect(409);
      await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(a))
        .send({ enabled: false })
        .expect(201);
      await r().delete(`/channels/connections/${c.id}`).set(h(a)).expect(200);
      await r().delete(`/outlets/${o2.id}`).set(h(a)).expect(200);
    });

    it('the location id cannot move under a live connection', async () => {
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ externalLocationId: 'moved' })
        .expect(409);
    });

    it('purges stored delivery bodies of old processed events but keeps the row', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'purge-sku', p.id);
      const res = await newOrder(
        ca,
        canon([{ id: 'purge-sku', priceMinor: 1000 }]),
      );
      await db.execute(
        `UPDATE channelinboundevent SET processedAt = ? WHERE id = ?`,
        [new Date(Date.now() - 40 * 86_400_000), res.inboxId],
      );
      await sweep.purgePayloads();
      const [ev] = await db.query<RowDataPacket[]>(
        `SELECT status, payload, payloadPurgedAt FROM channelinboundevent WHERE id = ?`,
        [res.inboxId],
      );
      expect(ev.status).toBe('processed');
      expect(ev.payload).toBeNull();
      expect(ev.payloadPurgedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('location ownership (review H1)', () => {
    async function pending(shop: W5Shop, loc = `LOC-${f.uniq()}`) {
      const o = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(shop))
          .send({ name: `own ${f.uniq()}` })
          .expect(201),
      );
      const created = await r()
        .post('/channels/connections')
        .set(h(shop))
        .send({
          outletId: o.id,
          provider: STUB_PROVIDER,
          externalLocationId: loc,
          credentials: { token: 'x' },
          webhookSecret: 'abcdefgh-secret',
        })
        .expect(201);
      return { id: created.body.id as number, loc };
    }
    const enable = (shop: W5Shop, id: number) =>
      r()
        .post(`/channels/connections/${id}/enabled`)
        .set(h(shop))
        .send({ enabled: true });
    const row = async (id: number) =>
      (
        await db.query<RowDataPacket[]>(
          `SELECT * FROM channelconnection WHERE id = ?`,
          [id],
        )
      )[0];

    it('enabling needs staff verification unless the provider has a merchant-bound proof', async () => {
      const c = await pending(a);
      const res = await enable(a, c.id).expect(409);
      expect(res.body.message).toMatch(/staff/i);
      expect((await row(c.id)).enabled).toBe(false);
      stub.merchantBoundProof = true;
      await enable(a, c.id).expect(201);
    });

    it('staff must state the very ids they checked, only platform staff can verify, and it is audited', async () => {
      const c = await pending(a);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ externalBrandId: 'BR-1' })
        .expect(200);
      await staffVerify(a, c.id, { externalLocationId: c.loc }).expect(409); // brand differs
      await staffVerify(a, c.id, {
        externalLocationId: 'other',
        externalBrandId: 'BR-1',
      }).expect(409);
      await staffVerify(b, c.id, {
        externalLocationId: c.loc,
        externalBrandId: 'BR-1',
      }).expect(409); // wrong shop
      // Not staff: no cookie, or a merchant admin token, is refused (the CSRF layer answers 403 before the guard's 404).
      await r()
        .post(
          `/platform-admin/shops/${a.shopId}/channel-connections/${c.id}/verify-location`,
        )
        .send({
          externalLocationId: c.loc,
          externalBrandId: 'BR-1',
          externalSiteId: null,
        })
        .then((res) => expect([403, 404]).toContain(res.status));
      await r()
        .post(
          `/platform-admin/shops/${a.shopId}/channel-connections/${c.id}/verify-location`,
        )
        .set(h(a))
        .send({
          externalLocationId: c.loc,
          externalBrandId: 'BR-1',
          externalSiteId: null,
        })
        .then((res) => expect([403, 404]).toContain(res.status));
      await staffVerify(a, c.id, {
        externalLocationId: c.loc,
        externalBrandId: 'BR-1',
      }).expect(201);
      const r1 = await row(c.id);
      expect(r1.locationVerifiedAt).not.toBeNull();
      expect(r1.locationVerifiedBy).toBe(platform.id);
      const audit = await db.query<RowDataPacket[]>(
        `SELECT metadata FROM platformauditlogentry WHERE action = 'shop.channel_connection.location_verified' AND shopId = ? AND platformAdminId = ?`,
        [a.shopId, platform.id],
      );
      expect(JSON.stringify(audit.map((x) => x.metadata as unknown))).toContain(
        c.loc,
      );
      // A merchant cannot set it through its own API.
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ locationVerifiedAt: new Date() })
        .expect(400);
      await enable(a, c.id).expect(201);
    });

    it('changing any id or the credentials clears the verification; a webhook secret rotation does not', async () => {
      const c = await pending(a);
      const verify = () =>
        staffVerify(a, c.id, {
          externalLocationId: c.loc,
          externalBrandId: null,
          externalSiteId: null,
        }).expect(201);
      const clear = async () => (await row(c.id)).locationVerifiedAt === null;
      await verify();
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ credentials: { token: 'new' } })
        .expect(200);
      expect(await clear()).toBe(true);
      await enable(a, c.id).expect(409);
      for (const patch of [
        { externalSiteId: 'S1' },
        { externalBrandId: 'B1' },
      ]) {
        await staffVerify(a, c.id, {
          externalLocationId: c.loc,
          externalBrandId: (await row(c.id)).externalBrandId,
          externalSiteId: (await row(c.id)).externalSiteId,
        }).expect(201);
        await r()
          .patch(`/channels/connections/${c.id}`)
          .set(h(a))
          .send(patch)
          .expect(200);
        expect(await clear()).toBe(true);
      }
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ externalLocationId: `${c.loc}-2` })
        .expect(200);
      await staffVerify(a, c.id, {
        externalLocationId: `${c.loc}-2`,
        externalBrandId: 'B1',
        externalSiteId: 'S1',
      }).expect(201);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ webhookSecret: 'rotated-secret-1' })
        .expect(200);
      expect(await clear()).toBe(false);
    });

    it('an id changed during the connection test cannot be enabled (staff-verified and merchant-bound paths)', async () => {
      const victim = ca.locationId;
      for (const bound of [false, true]) {
        const c = await pending(a);
        if (!bound)
          await staffVerify(a, c.id, { externalLocationId: c.loc }).expect(201);
        stub.merchantBoundProof = bound;
        stub.onTestConnection = async () => {
          await r()
            .patch(`/channels/connections/${c.id}`)
            .set(h(a))
            .send({ externalLocationId: victim })
            .expect(200);
        };
        await enable(a, c.id).expect(409);
        const after = await row(c.id);
        expect(after.enabled).toBe(false);
        expect(after.externalLocationId).toBe(victim);
        expect(after.routingKey).toBeNull();
        stub.reset();
      }
      // The same for a credential swapped during the test.
      const c = await pending(a);
      stub.merchantBoundProof = true;
      stub.onTestConnection = async () => {
        await r()
          .patch(`/channels/connections/${c.id}`)
          .set(h(a))
          .send({ credentials: { token: 'swapped' } })
          .expect(200);
      };
      await enable(a, c.id).expect(409);
      expect((await row(c.id)).enabled).toBe(false);
    });

    it('parallel enable and id change never leaves an enabled connection holding an unproven id', async () => {
      const victim = cb.locationId;
      for (let i = 0; i < 6; i++) {
        const c = await pending(a);
        await staffVerify(a, c.id, { externalLocationId: c.loc }).expect(201);
        await Promise.allSettled([
          enable(a, c.id),
          r()
            .patch(`/channels/connections/${c.id}`)
            .set(h(a))
            .send({ externalLocationId: victim }),
        ]);
        const after = await row(c.id);
        // Either it was enabled with the verified id, or it was not enabled at all.
        if (after.enabled) {
          expect(after.externalLocationId).toBe(c.loc);
          expect(after.locationVerifiedAt).not.toBeNull();
        } else {
          expect(after.routingKey).toBeNull();
        }
      }
    });

    it('ids of an enabled connection cannot change, and staff can withdraw verification (which disables it)', async () => {
      const c = await pending(a);
      await staffVerify(a, c.id, { externalLocationId: c.loc }).expect(201);
      await enable(a, c.id).expect(201);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ externalBrandId: 'X' })
        .expect(409);
      await r()
        .post(
          `/platform-admin/shops/${a.shopId}/channel-connections/${c.id}/unverify-location`,
        )
        .set('Cookie', platform.cookie)
        .set('X-CSRF-Token', platform.csrf)
        .expect(201);
      const after = await row(c.id);
      expect(after.enabled).toBe(false);
      expect(after.locationVerifiedAt).toBeNull();
    });

    it('a provider that echoes a credential in its message does not leak it into lastError', async () => {
      const c = await pending(a);
      stub.merchantBoundProof = true;
      stub.testConnectionOk = false;
      const orig = stub.testConnection.bind(stub);
      stub.testConnection = async (conn) => {
        const t = await orig(conn);
        return {
          ok: t.ok,
          provesLocation: t.provesLocation,
          message: `bad token ${conn.credentials?.token ?? ''} for you`,
        };
      };
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ credentials: { token: 'ultra-secret-token' } })
        .expect(200);
      const res = await enable(a, c.id).expect(400);
      stub.testConnection = orig;
      expect(JSON.stringify(res.body)).not.toContain('ultra-secret-token');
      expect((await row(c.id)).lastError).not.toContain('ultra-secret-token');
    });
  });

  // -------------------------------------------------------------------------
  describe('closing a link finishes the cancel (review M1, L4)', () => {
    async function fresh(stock = 10) {
      const p = await product(a, stock);
      const sku = `cl-${f.uniq()}`;
      await mapItem(a, sku, p.id);
      const o = canon([{ id: sku, qty: 2, priceMinor: 2500 }]);
      await newOrder(ca, o);
      return { p, o, co: await link(ca, o.externalOrderId) };
    }

    it('a cancel that failed after the state moved is finished by the inbox retry', async () => {
      const { p, o, co } = await fresh();
      const orders = app.get(OrdersService);
      const spy = jest
        .spyOn(orders, 'cancel')
        .mockRejectedValueOnce(new Error('db hiccup'));
      const ev = await statusEvent(ca, o.externalOrderId, 'cancelled');
      spy.mockRestore();
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'cancelled_upstream',
      );
      expect((await f.orderRow(co.orderId)).status).toBe('pending');
      expect(
        (
          await db.query<RowDataPacket[]>(
            `SELECT status FROM channelinboundevent WHERE id = ?`,
            [ev.inboxId],
          )
        )[0].status,
      ).toBe('failed');
      await db.execute(
        `UPDATE channelinboundevent SET nextAttemptAt = ? WHERE id = ?`,
        [new Date(Date.now() - 1000), ev.inboxId],
      );
      await sweep.replayDue();
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
    });

    it('and by the sweep when no retry comes', async () => {
      const { p, o, co } = await fresh();
      const spy = jest
        .spyOn(app.get(OrdersService), 'cancel')
        .mockRejectedValueOnce(new Error('db hiccup'));
      await statusEvent(ca, o.externalOrderId, 'rejected');
      spy.mockRestore();
      // Take the retry out of play: mark the inbox row processed.
      await db.execute(
        `UPDATE channelinboundevent SET status = 'processed' WHERE connectionId = ? AND externalOrderId = ?`,
        [ca.id, o.externalOrderId],
      );
      expect((await f.orderRow(co.orderId)).status).toBe('pending');
      await db.execute(`UPDATE channelorder SET updatedAt = ? WHERE id = ?`, [
        new Date(Date.now() - 3600_000),
        co.id,
      ]);
      const out = await sweep.staleOrders();
      expect(out.repaired).toBeGreaterThanOrEqual(1);
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
    });

    it('reads the order id AFTER closing, so an order created meanwhile is still cancelled', async () => {
      const { p, co } = await fresh();
      const stale = { ...co, orderId: null };
      await ingestion.closeUpstream(
        stale as never,
        'cancelled_upstream',
        'canceled',
      );
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(a.outletId, p.id)).toBe(10);
    });

    it('closing drops the canonical snapshot of a never-mapped order (review M4b)', async () => {
      const o = canon([{ id: `never2-${f.uniq()}`, priceMinor: 1000 }]);
      o.customer = {
        name: 'Private Person',
        phone: '0501234567',
        address: 'Secret street',
        notes: null,
      };
      await newOrder(ca, o);
      expect((await link(ca, o.externalOrderId)).canonical).not.toBeNull();
      await statusEvent(ca, o.externalOrderId, 'cancelled');
      expect((await link(ca, o.externalOrderId)).canonical).toBeNull();
    });

    it('cancel and confirm through the generic order routes are refused; the desk is the way (L4)', async () => {
      const { o, co } = await fresh();
      await r().post(`/orders/${co.orderId}/cancel`).set(h(a)).expect(409);
      await r()
        .patch(`/orders/${co.orderId}/status`)
        .set(h(a))
        .send({ status: 'confirmed' })
        .expect(409);
      await r()
        .patch(`/orders/${co.orderId}/status`)
        .set(h(a))
        .send({ status: 'cancelled' })
        .expect(409);
      expect((await link(ca, o.externalOrderId)).state).toBe(
        'pending_acceptance',
      );
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      // The kitchen steps stay open.
      await f.setStatus(a, co.orderId, 'preparing');
    });

    it('a failed alert enqueue rolls the stale claim back, so the next tick alerts (L4)', async () => {
      const { co } = await fresh();
      await db.execute(`UPDATE channelorder SET acceptBy = ? WHERE id = ?`, [
        new Date(Date.now() - 60_000),
        co.id,
      ]);
      const jobs = app.get(JobsService);
      const real = jobs.enqueue.bind(jobs) as typeof jobs.enqueue;
      const spy = jest
        .spyOn(jobs, 'enqueue')
        .mockImplementation((shopId, type, payload, key, opts) => {
          if (key === `channelorder:${co.id}:stale-alert`)
            return Promise.reject(new Error('queue down'));
          return real(shopId, type, payload, key, opts);
        });
      await expect(sweep.staleOrders()).rejects.toThrow('queue down');
      spy.mockRestore();
      expect(
        (
          await db.query<RowDataPacket[]>(
            `SELECT staleAlertedAt FROM channelorder WHERE id = ?`,
            [co.id],
          )
        )[0].staleAlertedAt,
      ).toBeNull();
      await sweep.staleOrders();
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co.id}:stale-alert`,
        ),
      ).toHaveLength(1);
    });

    it('replay needs an explicit, valid list of ids (L4)', async () => {
      for (const b2 of [
        {},
        { ids: [] },
        { ids: ['x'] },
        { ids: [1, 'x'] },
        { ids: [-1] },
        { ids: 'all' },
      ]) {
        await r().post('/channels/inbox/replay').set(h(a)).send(b2).expect(400);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('reserved channel names (review M2)', () => {
    it('hand-made orders cannot claim a marketplace channel, in any spelling', async () => {
      const p = await product(a, 10);
      for (const ch of [
        'deliveroo',
        'Deliveroo ',
        ' TALABAT',
        'stub_marketplace',
      ]) {
        await r()
          .post('/orders')
          .set(h(a))
          .send({
            customerName: 'X',
            customerPhone: '0501234567',
            customerAddress: 'Pickup',
            outletId: a.outletId,
            orderType: 'pickup',
            channel: ch,
            items: [{ productId: p.id, quantity: 1 }],
          })
          .expect(400);
      }
      await r()
        .post('/orders')
        .set(h(a))
        .send({
          customerName: 'X',
          customerPhone: '0501234567',
          customerAddress: 'Pickup',
          outletId: a.outletId,
          orderType: 'pickup',
          channel: 'Instagram',
          items: [{ productId: p.id, quantity: 1 }],
        })
        .expect(201);
      // And below the DTO, in the service.
      await expect(
        app.get(OrdersService).create(
          { userId: 1, shopId: a.shopId, role: 'admin', outletId: null },
          {
            customerName: 'X',
            customerPhone: '1',
            customerAddress: 'x',
            outletId: a.outletId,
            channel: 'Talabat',
            items: [{ productId: p.id, quantity: 1 }],
          },
        ),
      ).rejects.toThrow(/reserved/);
    });
  });

  // -------------------------------------------------------------------------
  describe('column widths (review M3)', () => {
    it('never dead-letters an accepted order for the length of a free-text field', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'len-sku', p.id);
      const o = canon([{ id: 'len-sku', priceMinor: 1000 }]);
      o.displayId = 'D'.repeat(200);
      o.lines[0].name = 'N'.repeat(600);
      o.lines[0].note = '😀'.repeat(900);
      o.customer = {
        name: 'ñ'.repeat(400),
        phone: '9'.repeat(400),
        address: '😀'.repeat(30000),
        notes: 'n'.repeat(50000),
      };
      const res = await newOrder(ca, o);
      expect(
        (
          await db.query<RowDataPacket[]>(
            `SELECT status, lastError FROM channelinboundevent WHERE id = ?`,
            [res.inboxId],
          )
        )[0],
      ).toMatchObject({ status: 'processed' });
      const co = await link(ca, o.externalOrderId);
      expect(co.displayId.length).toBe(64);
      const [ord] = await db.query<RowDataPacket[]>(
        `SELECT CHAR_LENGTH(customerName) AS n, CHAR_LENGTH(customerPhone) AS p, CHAR_LENGTH(customerAddress) AS a, CHAR_LENGTH(deliveryNotes) AS d FROM \`order\` WHERE id = ?`,
        [co.orderId],
      );
      expect(Number(ord.n)).toBe(191);
      expect(Number(ord.p)).toBe(191);
      expect(Number(ord.a)).toBe(10000);
      expect(Number(ord.d)).toBe(10000);
      const [it] = await db.query<RowDataPacket[]>(
        `SELECT CHAR_LENGTH(note) AS n FROM orderitem WHERE orderId = ?`,
        [co.orderId],
      );
      expect(Number(it.n)).toBe(255);
      // Unmapped item names too.
      const o2 = canon([
        { id: `len2-${f.uniq()}`, priceMinor: 1000, name: 'Z'.repeat(900) },
      ]);
      const r2 = await newOrder(ca, o2);
      expect(
        (
          await db.query<RowDataPacket[]>(
            `SELECT status FROM channelinboundevent WHERE id = ?`,
            [r2.inboxId],
          )
        )[0].status,
      ).toBe('processed');
    });
  });

  // -------------------------------------------------------------------------
  describe('retention (review M4, L1, L3)', () => {
    it('purges old failed and dead payloads like processed ones', async () => {
      const dead = await deliver(ca, { type: 'order.new' });
      await db.execute(
        `UPDATE channelinboundevent SET receivedAt = ? WHERE id = ?`,
        [new Date(Date.now() - 40 * 86_400_000), dead.inboxId],
      );
      await sweep.purgePayloads();
      const [ev] = await db.query<RowDataPacket[]>(
        `SELECT status, payload FROM channelinboundevent WHERE id = ?`,
        [dead.inboxId],
      );
      expect(ev.status).toBe('dead');
      expect(ev.payload).toBeNull();
    });

    it('blanks the customer details of old closed marketplace orders, keeps the sale, and is idempotent', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'ret-sku', p.id);
      const mk = async () => {
        const o = canon([{ id: 'ret-sku', priceMinor: 1000 }]);
        o.customer = {
          name: 'Sam K',
          phone: '0501234567',
          address: 'Street 1',
          notes: 'ring twice',
        };
        o.lines[0].note = 'no card';
        await newOrder(ca, o);
        return link(ca, o.externalOrderId);
      };
      const old = await mk();
      await r().post(`/channels/orders/${old.id}/accept`).set(h(a)).expect(201);
      for (const st of ['preparing', 'out_for_delivery', 'delivered'])
        await f.setStatus(a, old.orderId, st);
      const recent = await mk();
      await r()
        .post(`/channels/orders/${recent.id}/accept`)
        .set(h(a))
        .expect(201);
      for (const st of ['preparing', 'out_for_delivery', 'delivered'])
        await f.setStatus(a, recent.orderId, st);
      const open = await mk();
      await db.execute(
        `UPDATE auditlog SET createdAt = ? WHERE entityType = 'order' AND entityId = ?`,
        [new Date(Date.now() - 40 * 86_400_000), old.orderId],
      );
      await db.execute(`UPDATE \`order\` SET createdAt = ? WHERE id = ?`, [
        new Date(Date.now() - 40 * 86_400_000),
        open.orderId,
      ]);
      await sweep.scrubClosedOrders();
      const o1 = await f.orderRow(old.orderId);
      expect([o1.customerName, o1.customerPhone, o1.customerAddress]).toEqual([
        '',
        '',
        '',
      ]);
      expect(o1.deliveryNotes).toBeNull();
      expect(Number(o1.total)).toBe(10);
      expect((await f.orderItems(old.orderId))[0].note).toBeNull();
      expect(await f.orderItems(old.orderId)).toHaveLength(1);
      expect((await f.orderRow(recent.orderId)).customerName).toBe('Sam K');
      expect((await f.orderRow(open.orderId)).customerName).toBe('Sam K');
      await sweep.scrubClosedOrders();
      expect((await f.orderRow(old.orderId)).customerName).toBe('');
    });

    it('a connection with an unprocessed delivery cannot be deleted (L1)', async () => {
      const o = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `L1 ${f.uniq()}` })
          .expect(201),
      );
      const c = await connect(a, o.id);
      const dead = await deliver(c, { type: 'order.new' });
      await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(a))
        .send({ enabled: false })
        .expect(201);
      await r().delete(`/channels/connections/${c.id}`).set(h(a)).expect(409);
      await db.execute(
        `UPDATE channelinboundevent SET status = 'processed' WHERE id = ?`,
        [dead.inboxId],
      );
      await r().delete(`/channels/connections/${c.id}`).set(h(a)).expect(200);
    });

    it('a marketplace order is never reported to an ad platform (L3)', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'capi-sku', p.id);
      const o = canon([{ id: 'capi-sku', priceMinor: 1000 }]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      const consent = JSON.stringify({ consent: { marketing: true } });
      await db.execute(
        `UPDATE \`order\` SET attributionJson = ? WHERE id = ?`,
        [consent, co.orderId],
      );
      const normal = await f.adminOrder(a, [{ productId: p.id, quantity: 1 }]);
      await db.execute(
        `UPDATE \`order\` SET attributionJson = ? WHERE id = ?`,
        [consent, normal.id],
      );
      const spy = jest
        .spyOn(app.get(ShopAnalyticsService), 'resolveMetaCapiCredentials')
        .mockResolvedValue(null);
      const svc = app.get(ConversionEventsService);
      await svc.enqueuePurchase(normal.id);
      expect(spy).toHaveBeenCalledTimes(1); // control: the guard is what stops the marketplace order
      spy.mockClear();
      await svc.enqueuePurchase(co.orderId);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  describe('second review round', () => {
    it('M-A: an order with a marketplace channel string but no link is never locked or scrubbed', async () => {
      const p = await product(a, 10);
      const o = await f.adminOrder(a, [{ productId: p.id, quantity: 1 }], {
        customerName: 'Legacy Person',
      });
      await db.execute(
        `UPDATE \`order\` SET channel = 'deliveroo' WHERE id = ?`,
        [o.id],
      );
      // Not locked: the generic routes still work.
      await f
        .editItems(a, o.id, [{ productId: p.id, quantity: 2 }])
        .expect(200);
      await r()
        .patch(`/orders/${o.id}/delivery-fee`)
        .set(h(a))
        .send({ deliveryFee: 3 })
        .expect(200);
      await r()
        .patch(`/orders/${o.id}/status`)
        .set(h(a))
        .send({ status: 'confirmed' })
        .expect(200);
      await r().post(`/orders/${o.id}/cancel`).set(h(a)).expect(201);
      // Not scrubbed: cancelled long ago, would match on channel alone.
      await db.execute(
        `UPDATE auditlog SET createdAt = ? WHERE entityType = 'order' AND entityId = ?`,
        [new Date(Date.now() - 40 * 86_400_000), o.id],
      );
      await sweep.scrubClosedOrders();
      expect((await f.orderRow(o.id)).customerName).toBe('Legacy Person');
    });

    it('M-B: deleting a connection cannot race an inbound delivery into losing it', async () => {
      const ob = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `MB ${f.uniq()}` })
          .expect(201),
      );
      const c = await connect(a, ob.id);
      await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(a))
        .send({ enabled: false })
        .expect(201);
      // A delivery is acknowledged between the guard checks and the DELETE.
      const real = db.execute.bind(db) as typeof db.execute;
      let raced: { inboxId: number } | undefined;
      const spy = jest
        .spyOn(db, 'execute')
        .mockImplementation(async (sql, params) => {
          if (
            typeof sql === 'string' &&
            sql.startsWith('DELETE FROM channelconnection') &&
            !raced
          ) {
            raced = { inboxId: 0 };
            await real(
              `INSERT INTO channelinboundevent (shopId, connectionId, provider, eventId, signatureVerified, payloadHash, payload, receivedAt, nextAttemptAt)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
              [
                a.shopId,
                c.id,
                STUB_PROVIDER,
                `race-${f.uniq()}`,
                'h'.repeat(64),
                JSON.stringify({ type: 'noop' }),
                new Date(),
                new Date(),
              ],
            );
          }
          return real(sql, params);
        });
      await r().delete(`/channels/connections/${c.id}`).set(h(a)).expect(409);
      spy.mockRestore();
      expect(
        await db.query<RowDataPacket[]>(
          `SELECT 1 FROM channelinboundevent WHERE connectionId = ?`,
          [c.id],
        ),
      ).toHaveLength(1);
      expect(
        await db.query<RowDataPacket[]>(
          `SELECT 1 FROM channelconnection WHERE id = ?`,
          [c.id],
        ),
      ).toHaveLength(1);
    });

    it('L1: a failing poll does not leak a credential into lastError', async () => {
      const ob = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `L1p ${f.uniq()}` })
          .expect(201),
      );
      const c = await connect(a, ob.id);
      const orig = stub.listOpenOrders.bind(stub);
      stub.listOpenOrders = () =>
        Promise.reject(new Error('401 for token tok-leak-check'));
      await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(a))
        .send({ enabled: false })
        .expect(201);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ credentials: { token: 'tok-leak-check' } })
        .expect(200);
      await staffVerify(a, c.id, { externalLocationId: c.locationId }).expect(
        201,
      );
      await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(a))
        .send({ enabled: true })
        .expect(201);
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [c.id],
      );
      await sweep.pollConnections();
      stub.listOpenOrders = orig;
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT lastSyncStatus, lastError FROM channelconnection WHERE id = ?`,
        [c.id],
      );
      expect(row.lastSyncStatus).toBe('failed');
      expect(row.lastError).not.toContain('tok-leak-check');
    });

    it('L2: credentials and the webhook secret of an ENABLED connection cannot be replaced or cleared', async () => {
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ credentials: { token: 'z' } })
        .expect(409);
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ credentials: null })
        .expect(409);
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ webhookSecret: 'another-secret-1' })
        .expect(409);
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ webhookSecret: null })
        .expect(409);
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT credentials, webhookSecret FROM channelconnection WHERE id = ?`,
        [ca.id],
      );
      expect(row.credentials).not.toBeNull();
      expect(row.webhookSecret).not.toBeNull();
    });

    it('L3 and L8: the alert label is clipped, and commission is for admins only', async () => {
      const p = await product(a, 10);
      await mapItem(a, 'l3-sku', p.id);
      const o = canon(
        [{ id: 'l3-sku', priceMinor: 1000 }],
        {},
        { commissionMinor: 250 },
      );
      o.displayId = 'Q'.repeat(150);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      const [job] = await jobsOf(
        a.shopId,
        'send_merchant_whatsapp_alert',
        `channelorder:${co.id}:alert`,
      );
      expect(JSON.stringify(job.payload)).not.toContain('Q'.repeat(65));
      const adminList = await r().get('/channels/orders').set(h(a)).expect(200);
      expect(
        adminList.body.data.find((x: { id: number }) => x.id === co.id)
          .commissionAmount,
      ).toBe('2.5');
      const branch = await createStaff(
        app,
        a.adminToken,
        'cm',
        'branch',
        a.outletId,
      );
      const om = await createStaff(app, a.adminToken, 'cm', 'order_manager');
      for (const t of [branch.token, om.token]) {
        const l = await r()
          .get('/channels/orders')
          .set({ Authorization: `Bearer ${t}` })
          .expect(200);
        const row = l.body.data.find((x: { id: number }) => x.id === co.id);
        expect(row).toBeDefined();
        expect(row.commissionAmount).toBeNull();
      }
    });

    it('L5: a marketplace-accepted order that still needs mapping is not treated as settled', async () => {
      const o = canon([{ id: `l5-${f.uniq()}`, priceMinor: 1000 }]);
      await newOrder(ca, o);
      const co = await link(ca, o.externalOrderId);
      await db.execute(`UPDATE channelorder SET acceptBy = ? WHERE id = ?`, [
        new Date(Date.now() - 60_000),
        co.id,
      ]);
      stub.statuses.set(o.externalOrderId, 'accepted');
      await sweep.staleOrders();
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co.id}:stale-alert`,
        ),
      ).toHaveLength(1);
    });
  });
});
