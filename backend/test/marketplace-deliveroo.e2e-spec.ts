/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- bodies are untyped supertest JSON and fixtures are untyped JSON */
import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { bootApp, makeFixtures, body, type W5Shop } from './helpers/w5-fixture';
import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_WEBHOOK_SECRET,
  aed,
  deliverooHeaders,
  fakeOrder,
  kwd,
  signDeliveroo,
  webhookBody,
} from './helpers/deliveroo-fixtures';
import { DatabaseService } from '../src/database/database.service';
import { ChannelIngestionService } from '../src/channels/channel-ingestion.service';
import { ChannelConnectionsService } from '../src/channels/channel-connections.service';
import { ChannelSweepService } from '../src/channels/channel-sweep.service';
import { ChannelProviderRegistry } from '../src/channels/channel-provider.registry';
import {
  DELIVEROO_PROVIDER,
  DeliverooChannelProvider,
} from '../src/channels/providers/deliveroo/deliveroo-channel.provider';
import {
  DELIVEROO_MAX_BODY_BYTES,
  DeliverooWebhookController,
} from '../src/channels/providers/deliveroo/deliveroo-webhook.controller';

jest.setTimeout(300000);

const PLATFORM_SECRET = 'fake-platform-webhook-secret-not-real-0003';
const PLATFORM_CLIENT_ID = 'fake-platform-client-id-not-real';
const PLATFORM_CLIENT_SECRET = 'fake-platform-client-secret-not-real-0004';
const ENV_KEYS = [
  'DELIVEROO_SANDBOX_CLIENT_ID',
  'DELIVEROO_SANDBOX_CLIENT_SECRET',
  'DELIVEROO_SANDBOX_WEBHOOK_SECRET',
] as const;

interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}

// E2: the Deliveroo provider and its public webhook route, over real HTTP with
// locally signed fixtures and a FAKE sandbox (global fetch is never used: the
// provider's client is handed a fake). No real credential or id appears here.
describe('Deliveroo marketplace channel (E2)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let ingestion: ChannelIngestionService;
  let sweep: ChannelSweepService;
  let provider: DeliverooChannelProvider;
  const savedEnv: Record<string, string | undefined> = {};
  const r = () => request(app.getHttpServer());
  const h = (s: W5Shop) => ({ Authorization: `Bearer ${s.adminToken}` });

  // ---- fake Deliveroo sandbox ------------------------------------------------
  const calls: FakeCall[] = [];
  const orderStatus = new Map<string, string>();
  let patchHandler: (c: FakeCall) => {
    status: number;
    json?: unknown;
    retryAfter?: number;
  } = () => ({ status: 204 });
  let listHandler: (c: FakeCall) => {
    status: number;
    json?: unknown;
  } = () => ({ status: 200, json: { orders: [] } });
  let tokenCalls = 0;
  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed =
      typeof init?.body === 'string' && init.body.startsWith('{')
        ? JSON.parse(init.body)
        : init?.body;
    const call: FakeCall = { method: init?.method ?? 'GET', url, body: parsed };
    let out: { status: number; json?: unknown; retryAfter?: number };
    if (url.includes('/oauth2/token')) {
      tokenCalls += 1;
      out = {
        status: 200,
        json: { access_token: 'tok-fake', expires_in: 300 },
      };
    } else {
      calls.push(call);
      if (call.method === 'PATCH') out = patchHandler(call);
      else if (call.method === 'GET' && url.includes('/orders?'))
        out = listHandler(call);
      else if (call.method === 'GET') {
        const id = url.split('/v2/orders/')[1];
        out = orderStatus.has(id)
          ? { status: 200, json: { status: orderStatus.get(id) } }
          : { status: 404 };
      } else out = { status: 200, json: {} };
    }
    return Promise.resolve(
      new Response(out.status === 204 ? null : JSON.stringify(out.json ?? {}), {
        status: out.status,
        headers: out.retryAfter
          ? { 'retry-after': String(out.retryAfter) }
          : {},
      }),
    );
  };
  const patches = () => calls.filter((c) => c.method === 'PATCH');

  // ---- fixtures ----------------------------------------------------------------
  interface Conn {
    shop: W5Shop;
    id: number;
    locationId: string;
    secret: string;
    outletId: number;
  }
  let platform: { cookie: string; csrf: string };
  let a: W5Shop;
  let b: W5Shop;
  let ca: Conn;
  let cb: Conn;
  let gseq = 0;

  async function grantFlag(shop: W5Shop) {
    await db.execute(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'marketplace_channels', 1)
       ON DUPLICATE KEY UPDATE enabled = 1`,
      [shop.shopId],
    );
  }

  async function connect(
    shop: W5Shop,
    opts: {
      outletId?: number;
      locationId?: string;
      ownSecret?: boolean;
      credentials?: Record<string, string>;
    } = {},
  ): Promise<Conn> {
    const outletId = opts.outletId ?? shop.outletId;
    const locationId = opts.locationId ?? `FAKE-LOC-${f.uniq()}`;
    const secret =
      opts.ownSecret === false
        ? PLATFORM_SECRET
        : `fake-conn-secret-${f.uniq()}-abcdefgh`;
    const created = await r()
      .post('/channels/connections')
      .set(h(shop))
      .send({
        outletId,
        provider: DELIVEROO_PROVIDER,
        externalLocationId: locationId,
        externalBrandId: 'FAKE-BRAND-1',
        externalSiteId: 'FAKE-SITE-1',
        credentials: opts.credentials ?? {
          clientId: FAKE_CLIENT_ID,
          clientSecret: FAKE_CLIENT_SECRET,
        },
        ...(opts.ownSecret === false ? {} : { webhookSecret: secret }),
      })
      .expect(201);
    const id = body<{ id: number }>(created).id;
    await staffVerify(shop, id, {
      externalLocationId: locationId,
      externalBrandId: 'FAKE-BRAND-1',
      externalSiteId: 'FAKE-SITE-1',
    }).expect(201);
    await r()
      .post(`/channels/connections/${id}/enabled`)
      .set(h(shop))
      .send({ enabled: true })
      .expect(201);
    return { shop, id, locationId, secret, outletId };
  }

  function staffVerify(
    shop: W5Shop,
    connectionId: number,
    t: {
      externalLocationId: string;
      externalBrandId?: string | null;
      externalSiteId?: string | null;
    },
  ) {
    return r()
      .post(
        `/platform-admin/shops/${shop.shopId}/channel-connections/${connectionId}/verify-location`,
      )
      .set('Cookie', platform.cookie)
      .set('X-CSRF-Token', platform.csrf)
      .send({ externalBrandId: null, externalSiteId: null, ...t });
  }

  async function newOutlet(shop: W5Shop) {
    return body<{ id: number }>(
      await r()
        .post('/outlets')
        .set(h(shop))
        .send({ name: `Extra ${f.uniq()}` })
        .expect(201),
    ).id;
  }

  const sku = () => `FAKE-SKU-${f.uniq()}`;
  async function mapItem(
    shop: W5Shop,
    externalItemId: string,
    productId: number,
  ) {
    await r()
      .post('/channels/mappings')
      .set(h(shop))
      .send({ provider: DELIVEROO_PROVIDER, externalItemId, productId })
      .expect(201);
  }

  // A signed order for a connection. `items` default to one mapped line.
  function ord(c: Conn, over: Record<string, unknown> = {}) {
    return fakeOrder({
      location_id: c.locationId,
      brand_id: 'FAKE-BRAND-1',
      ...over,
    });
  }
  const line = (
    id: string,
    qty: number,
    unitMinor: number,
    extra: Record<string, unknown> = {},
  ) => ({
    pos_item_id: id,
    name: `Item ${id}`,
    quantity: qty,
    unit_price: aed(unitMinor),
    total_price: aed(unitMinor),
    menu_unit_price: aed(unitMinor),
    discount_amount: aed(0),
    modifiers: [],
    ...extra,
  });

  function post(raw: string | Buffer, headers: Record<string, string>) {
    let req = r().post('/channels/deliveroo/webhook');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(raw);
  }

  async function inboxRows(connId: number) {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM channelinboundevent WHERE connectionId = ? ORDER BY id`,
      [connId],
    );
  }

  // Waits for the post-ACK processing (setImmediate) to finish, driving it if it
  // has not started.
  async function settle(connId: number, guid: string) {
    for (let i = 0; i < 100; i++) {
      const rows = (await inboxRows(connId)).filter((x) =>
        String(x.eventId).startsWith(`${guid}:`),
      );
      if (rows.length === 0) return;
      const row = rows[0];
      if (['processed', 'dead'].includes(row.status as string)) return;
      if (row.status === 'received')
        await ingestion.processInboxEvent(row.id as number);
      else if (row.status === 'failed') return;
      await new Promise((res) => setTimeout(res, 50));
    }
  }

  async function deliver(
    c: Conn,
    event: 'order.new' | 'order.status_update',
    order: Record<string, unknown>,
    opts: { guid?: string; secret?: string } = {},
  ) {
    const raw = webhookBody(event, order);
    const guid = opts.guid ?? `g-${f.runId}-${++gseq}`;
    const res = await post(
      raw,
      deliverooHeaders(opts.secret ?? c.secret, guid, raw),
    );
    if (res.status === 200) await settle(c.id, guid);
    return { res, raw, guid };
  }
  const newOrder = (c: Conn, o: Record<string, unknown>, opts = {}) =>
    deliver(c, 'order.new', o, opts);
  const statusEvent = (
    c: Conn,
    o: Record<string, unknown>,
    status: string,
    opts = {},
  ) =>
    deliver(
      c,
      'order.status_update',
      {
        ...o,
        status,
        status_log: [
          ...(o.status_log as object[]),
          { status, at: new Date().toISOString() },
        ],
      },
      opts,
    );

  async function link(c: Conn, externalOrderId: string) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
      [c.id, externalOrderId],
    );
    return rows[0];
  }
  const countLinks = async (c: Conn, id: string) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
          [c.id, id],
        )
      )[0].n,
    );
  const countInbox = async (...ids: number[]) =>
    Number(
      (
        await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM channelinboundevent WHERE connectionId IN (${ids.map(() => '?').join(',')})`,
          ids,
        )
      )[0].n,
    );
  async function jobsOf(shopId: number, type: string, like = '%') {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM job WHERE shopId = ? AND type = ? AND idempotencyKey LIKE ?`,
      [shopId, type, like],
    );
  }

  // A mapped product at shop a with `stock` units, and a ready-to-use order for it.
  async function fresh(
    c: Conn,
    stock = 10,
    over: Record<string, unknown> = {},
    qty = 2,
  ) {
    const p = await f.stockedProduct(c.shop, stock, { price: 25 });
    const id = sku();
    await mapItem(c.shop, id, p.id);
    const o = ord(c, {
      items: [line(id, qty, 2500)],
      total_price: aed(2500 * qty),
      subtotal: aed(2500 * qty),
      ...over,
    });
    return { p, id, o };
  }

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.DELIVEROO_SANDBOX_WEBHOOK_SECRET = PLATFORM_SECRET;
    process.env.DELIVEROO_SANDBOX_CLIENT_ID = PLATFORM_CLIENT_ID;
    process.env.DELIVEROO_SANDBOX_CLIENT_SECRET = PLATFORM_CLIENT_SECRET;
    const booted = await bootApp({ rawBody: true });
    app = booted.app;
    // Listening once lets concurrent supertest requests share one server.
    await app.listen(0);
    db = booted.db;
    f = makeFixtures(app, db);
    ingestion = app.get(ChannelIngestionService);
    sweep = app.get(ChannelSweepService);
    provider = app.get(DeliverooChannelProvider);
    provider.api.fetchImpl = fakeFetch;
    provider.sleep = () => Promise.resolve();
    const email = `dlv-staff-${f.runId}@test.com`;
    await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [email, await bcrypt.hash('platform-password-123', 10), 'Dlv Staff'],
    );
    const login = await r()
      .post('/platform-auth/login')
      .send({ email, password: 'platform-password-123' })
      .expect(201);
    const jar: Record<string, string> = {};
    for (const l of login.get('Set-Cookie') ?? []) {
      const pair = l.split(';')[0];
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    platform = {
      cookie: Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      csrf: login.get('X-CSRF-Token') as string,
    };
    a = await f.setupShop('dlv-a');
    b = await f.setupShop('dlv-b');
    await grantFlag(a);
    await grantFlag(b);
    await db.execute(
      `UPDATE outlet SET whatsapp = '+971501112233' WHERE id IN (?, ?)`,
      [a.outletId, b.outletId],
    );
    ca = await connect(a);
    cb = await connect(b);
  });
  beforeEach(() => {
    calls.length = 0;
    orderStatus.clear();
    patchHandler = () => ({ status: 204 });
    listHandler = () => ({ status: 200, json: { orders: [] } });
    provider.api.now = () => Date.now();
  });
  afterAll(async () => {
    // Leave no overdue open orders behind: ChannelSweepService.staleOrders works
    // oldest first in batches of 50 across ALL shops, so a backlog from this
    // spec would starve other specs' stale-order tests on a re-run.
    await db.execute(
      `UPDATE channelorder SET staleAlertedAt = ? WHERE shopId IN (?, ?) AND staleAlertedAt IS NULL`,
      [new Date(), a.shopId, b.shopId],
    );
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await app.close();
  });

  // ===========================================================================
  describe('ships disabled, ownership stays with platform staff', () => {
    it('the provider is registered but does not claim to prove location ownership', () => {
      expect(app.get(ChannelProviderRegistry).has(DELIVEROO_PROVIDER)).toBe(
        true,
      );
      expect(provider.capabilities.provesLocationOwnership).toBe(false);
    });
    it('without the platform flag a shop cannot create a Deliveroo connection', async () => {
      const c = await f.setupShop('dlv-off');
      await r()
        .post('/channels/connections')
        .set(h(c))
        .send({ outletId: c.outletId, provider: DELIVEROO_PROVIDER })
        .expect(403);
    });
    it('a new connection is OFF, and even with a passing test it cannot be enabled without staff verification', async () => {
      const outletId = await newOutlet(a);
      const res = await r()
        .post('/channels/connections')
        .set(h(a))
        .send({
          outletId,
          provider: DELIVEROO_PROVIDER,
          externalLocationId: `FAKE-LOC-${f.uniq()}`,
          credentials: {
            clientId: FAKE_CLIENT_ID,
            clientSecret: FAKE_CLIENT_SECRET,
          },
          webhookSecret: 'another-fake-secret-12345678',
        })
        .expect(201);
      expect(res.body.enabled).toBe(false);
      await r()
        .post(`/channels/connections/${res.body.id}/enabled`)
        .set(h(a))
        .send({ enabled: true })
        .expect(409);
    });
    it('the connection test works against the fake sandbox and never returns a credential', async () => {
      const res = await r()
        .post(`/channels/connections/${ca.id}/test`)
        .set(h(a))
        .expect(201);
      expect(res.body).toEqual({ ok: true, message: null });
      const dump = JSON.stringify(
        (await r().get('/channels/connections').set(h(a))).body,
      );
      for (const s of [
        FAKE_CLIENT_ID,
        FAKE_CLIENT_SECRET,
        ca.secret,
        PLATFORM_SECRET,
      ])
        expect(dump).not.toContain(s);
    });
  });

  // ===========================================================================
  describe('webhook security', () => {
    it('S12 bad HMAC, missing headers and wrong secret all get the SAME 401 and write nothing', async () => {
      const o = ord(ca);
      const raw = webhookBody('order.new', o);
      const before = await countInbox(ca.id, cb.id);
      const good = deliverooHeaders(ca.secret, 'g-x-1', raw);
      const attempts: Record<string, string>[] = [
        { ...good, 'x-deliveroo-hmac-sha256': '0'.repeat(64) },
        { ...good, 'x-deliveroo-hmac-sha256': 'nothex' },
        deliverooHeaders('wrong-secret-entirely', 'g-x-2', raw),
        deliverooHeaders(cb.secret, 'g-x-3', raw), // another tenant's secret on A's location
        { 'content-type': 'application/json' },
        {
          'x-deliveroo-sequence-guid': 'g-x-4',
          'content-type': 'application/json',
        },
        {
          'x-deliveroo-hmac-sha256': good['x-deliveroo-hmac-sha256'],
          'content-type': 'application/json',
        },
        { ...good, 'x-deliveroo-sequence-guid': 'g-x-1 x' }, // whitespace in the signed guid
      ];
      const bodies: string[] = [];
      for (const hd of attempts) {
        const res = await post(raw, hd);
        expect(res.status).toBe(401);
        bodies.push(JSON.stringify(res.body));
      }
      expect(new Set(bodies).size).toBe(1);
      expect(await countInbox(ca.id, cb.id)).toBe(before);
      expect(await link(ca, o.id)).toBeUndefined();
    });

    it('S13 an unknown location id is the same 401, with no hint', async () => {
      const raw = webhookBody(
        'order.new',
        fakeOrder({ location_id: 'FAKE-NOT-A-LOCATION' }),
      );
      const known = await post(
        raw.replace('FAKE-NOT-A-LOCATION', ca.locationId),
        deliverooHeaders('wrong', 'g-u-1', raw),
      );
      const unknown = await post(
        raw,
        deliverooHeaders(ca.secret, 'g-u-2', raw),
      );
      expect(unknown.status).toBe(401);
      expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(known.body));
    });

    it("S14 another tenant: A's secret on B's location is refused, and a valid delivery for B only ever creates B's order", async () => {
      const o = ord(cb);
      const refused = await post(
        webhookBody('order.new', o),
        deliverooHeaders(ca.secret, 'g-t-1', webhookBody('order.new', o)),
      );
      expect(refused.status).toBe(401);
      const stock = await fresh(cb);
      expect((await newOrder(cb, stock.o)).res.status).toBe(200);
      expect(await link(cb, stock.o.id)).toBeDefined();
      expect(await link(ca, stock.o.id)).toBeUndefined();
      const row = await link(cb, stock.o.id);
      expect(row.shopId).toBe(b.shopId);
    });

    it('the routing key is body.order.location_id and nothing else (a decoy location elsewhere in the signed body is ignored)', async () => {
      const { o } = await fresh(ca);
      const raw = JSON.stringify({
        event: 'order.new',
        location_id: cb.locationId,
        body: { location_id: cb.locationId, order: o },
      });
      const guid = `g-d-${++gseq}`;
      const res = await post(raw, deliverooHeaders(ca.secret, guid, raw));
      expect(res.status).toBe(200);
      await settle(ca.id, guid);
      expect(await link(ca, o.id)).toBeDefined();
      expect(await link(cb, o.id)).toBeUndefined();
    });

    it('a disabled connection is refused with the same 401', async () => {
      const c = await connect(a, { outletId: await newOutlet(a) });
      expect((await newOrder(c, ord(c))).res.status).toBe(200);
      await r()
        .post(`/channels/connections/${c.id}/enabled`)
        .set(h(a))
        .send({ enabled: false })
        .expect(201);
      const o = ord(c);
      const raw = webhookBody('order.new', o);
      const res = await post(raw, deliverooHeaders(c.secret, 'g-dis-1', raw));
      expect(res.status).toBe(401);
      expect(await link(c, o.id)).toBeUndefined();
    });

    it('a delivery whose signed status time is stale is refused (replay of an old capture), nothing written', async () => {
      const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const o = ord(ca, { status_log: [{ status: 'placed', at: old }] });
      const raw = webhookBody('order.new', o);
      const before = await countInbox(ca.id);
      const res = await post(
        raw,
        deliverooHeaders(ca.secret, `g-old-${++gseq}`, raw),
      );
      expect(res.status).toBe(401);
      expect(await countInbox(ca.id)).toBe(before);
    });

    it('an oversize body is refused before anything is written, even when correctly signed', async () => {
      const raw = webhookBody(
        'order.new',
        ord(ca, { order_notes: 'x'.repeat(DELIVEROO_MAX_BODY_BYTES + 5000) }),
      );
      const before = await countInbox(ca.id);
      const res = await post(
        raw,
        deliverooHeaders(ca.secret, `g-big-${++gseq}`, raw),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await countInbox(ca.id)).toBe(before);
      // The explicit cap in the controller holds on its own, whatever the parser does.
      const ctrl = app.get(DeliverooWebhookController);
      await expect(
        ctrl.receive({
          rawBody: Buffer.alloc(DELIVEROO_MAX_BODY_BYTES + 1, 1),
          headers: {},
        } as never),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        ctrl.receive({ rawBody: undefined, headers: {} } as never),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('a body that is not JSON is refused by the parser and writes nothing; unsupported events are acknowledged and ignored', async () => {
      // Express's JSON parser answers before the handler (same for every tenant).
      const bad = 'not json';
      const before = await countInbox(ca.id);
      expect(
        (await post(bad, deliverooHeaders(ca.secret, 'g-nj', bad))).status,
      ).toBeGreaterThanOrEqual(400);
      expect(await countInbox(ca.id)).toBe(before);
      const raw = webhookBody('order.new', ord(ca)).replace(
        '"order.new"',
        '"rider.assigned"',
      );
      const guid = `g-ig-${++gseq}`;
      expect(
        (await post(raw, deliverooHeaders(ca.secret, guid, raw))).status,
      ).toBe(200);
      await settle(ca.id, guid);
      const row = (await inboxRows(ca.id)).find((x) =>
        String(x.eventId).startsWith(`${guid}:`),
      );
      expect(row?.status).toBe('processed');
    });

    it('the platform webhook secret works for a connection that has none of its own, and a wrong one does not', async () => {
      const c = await connect(a, {
        outletId: await newOutlet(a),
        ownSecret: false,
        credentials: { useSandboxPlatformCredentials: 'yes' },
      });
      const { o } = await fresh(c);
      expect((await newOrder(c, o)).res.status).toBe(200);
      expect(await link(c, o.id)).toBeDefined();
      const o2 = ord(c);
      const raw = webhookBody('order.new', o2);
      expect(
        (
          await post(
            raw,
            deliverooHeaders('not-the-platform-secret', 'g-p-1', raw),
          )
        ).status,
      ).toBe(401);
    });

    it('M1 a connection with its own secret rejects the platform secret (401, nothing written)', async () => {
      const o = ord(ca);
      const raw = webhookBody('order.new', o);
      const before = await countInbox(ca.id);
      const res = await post(
        raw,
        deliverooHeaders(PLATFORM_SECRET, `g-m1-${++gseq}`, raw),
      );
      expect(res.status).toBe(401);
      expect(await countInbox(ca.id)).toBe(before);
      expect(await link(ca, o.id)).toBeUndefined();
    });

    it('M1 the platform secret is accepted for a connection without its own secret only outside production, and in production only with the explicit flag', async () => {
      const c = await connect(a, {
        outletId: await newOutlet(a),
        ownSecret: false,
      });
      const send = async () => {
        const o = ord(c);
        const raw = webhookBody('order.new', o);
        const res = await post(
          raw,
          deliverooHeaders(PLATFORM_SECRET, `g-m1p-${++gseq}`, raw),
        );
        return { res, o };
      };
      expect((await send()).res.status).toBe(200);
      // Prepared before NODE_ENV changes (the staff test bearer is test-only).
      const created = await r()
        .post('/channels/connections')
        .set(h(a))
        .send({
          outletId: await newOutlet(a),
          provider: DELIVEROO_PROVIDER,
          externalLocationId: `FAKE-LOC-${f.uniq()}`,
          credentials: {
            clientId: FAKE_CLIENT_ID,
            clientSecret: FAKE_CLIENT_SECRET,
          },
        })
        .expect(201);
      const noSecret = {
        id: created.body.id as number,
      };
      await staffVerify(a, noSecret.id, {
        externalLocationId: (
          await db.query<RowDataPacket[]>(
            `SELECT externalLocationId FROM channelconnection WHERE id = ?`,
            [noSecret.id],
          )
        )[0].externalLocationId as string,
      }).expect(201);
      const prevEnv = process.env.NODE_ENV;
      const prevFlag = process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET;
        const before = await countInbox(c.id);
        const refused = await send();
        expect(refused.res.status).toBe(401);
        expect(await countInbox(c.id)).toBe(before);
        // Enabling is refused too: there would be no usable secret.
        await expect(
          app
            .get(ChannelConnectionsService)
            .setEnabled(
              { userId: 1, shopId: a.shopId, role: 'admin', outletId: null },
              noSecret.id,
              true,
            ),
        ).rejects.toMatchObject({ status: 400 });
        process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET = '1';
        const allowed = await send();
        expect(allowed.res.status).toBe(200);
        await settle(c.id, 'g-m1p-');
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevFlag === undefined)
          delete process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET;
        else process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET = prevFlag;
      }
    });

    it('L3 a correctly signed body without a parseable status_log is refused with the same 401', async () => {
      for (const order of [
        { ...ord(ca), status_log: undefined },
        { ...ord(ca), status_log: [] },
        { ...ord(ca), status_log: [{ status: 'placed', at: 'not a date' }] },
      ]) {
        const raw = webhookBody('order.new', order);
        const before = await countInbox(ca.id);
        const res = await post(
          raw,
          deliverooHeaders(ca.secret, `g-l3-${++gseq}`, raw),
        );
        expect(res.status).toBe(401);
        expect(await countInbox(ca.id)).toBe(before);
      }
    });

    it('L4 an unknown location still goes through one HMAC comparison (timing equaliser), with a dummy secret', async () => {
      const spy = jest.spyOn(provider, 'verifyWebhook');
      try {
        const raw = webhookBody(
          'order.new',
          fakeOrder({ location_id: 'FAKE-NOPE' }),
        );
        const res = await post(
          raw,
          deliverooHeaders(ca.secret, `g-l4-${++gseq}`, raw),
        );
        expect(res.status).toBe(401);
        expect(spy).toHaveBeenCalledTimes(1);
        const secrets = spy.mock.calls[0][0].secrets;
        expect(secrets).toHaveLength(1);
        for (const real of [ca.secret, cb.secret, PLATFORM_SECRET])
          expect(secrets).not.toContain(real);
      } finally {
        spy.mockRestore();
      }
    });

    it('L1 a brand, site or location id of ".." (or any path-like id) is refused at the API', async () => {
      for (const bad of ['..', '.', '../x', 'a/b', '.hidden']) {
        for (const field of [
          'externalBrandId',
          'externalSiteId',
          'externalLocationId',
        ]) {
          await r()
            .post('/channels/connections')
            .set(h(a))
            .send({
              outletId: a.outletId,
              provider: DELIVEROO_PROVIDER,
              externalLocationId: 'FAKE-OK',
              [field]: bad,
            })
            .expect(400);
        }
      }
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ externalBrandId: '..' })
        .expect(400);
    });

    it('M2 the provider declares its name and exact credential fields to the admin', async () => {
      const res = await r().get('/channels/providers').set(h(a)).expect(200);
      const d = res.body.find((x: { name: string }) => x.name === 'deliveroo');
      expect(d.displayName).toBe('Deliveroo');
      expect(d.credentialFields).toEqual([
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client secret' },
      ]);
    });

    it('no secret or credential appears in a stored error or a job payload', async () => {
      const rows = await db.query<RowDataPacket[]>(
        `SELECT CONCAT_WS(' ', e.lastError, c.lastError) AS t FROM channelconnection c LEFT JOIN channelinboundevent e ON e.connectionId = c.id WHERE c.shopId IN (?, ?)`,
        [a.shopId, b.shopId],
      );
      const jobs = await db.query<RowDataPacket[]>(
        `SELECT CAST(payload AS CHAR) AS t FROM job WHERE shopId IN (?, ?)`,
        [a.shopId, b.shopId],
      );
      const all = JSON.stringify([...rows, ...jobs]);
      for (const s of [
        FAKE_CLIENT_SECRET,
        FAKE_WEBHOOK_SECRET,
        PLATFORM_SECRET,
        PLATFORM_CLIENT_SECRET,
        'tok-fake',
      ])
        expect(all).not.toContain(s);
    });
  });

  // ===========================================================================
  describe('go-live scenarios (plan section 8)', () => {
    it('S01 order.new (placed, ASAP) creates the order, holds stock and alerts the merchant', async () => {
      const { p, o } = await fresh(ca);
      const { res } = await newOrder(ca, o);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
      const co = await link(ca, o.id);
      expect(co.state).toBe('pending_acceptance');
      const order = await f.orderRow(co.orderId);
      expect(order.channel).toBe('deliveroo');
      expect(order.paymentMethod).toBe('deliveroo');
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(8);
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co.id}:alert`,
        ),
      ).toHaveLength(1);
      expect(order.taxAmount ?? null).toBeNull();
      expect(co.commissionAmount ?? null).toBeNull();
    });

    it('S02 accept sends PATCH accepted, and order.status_update accepted confirms the order once', async () => {
      const { p, o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect(patches()).toHaveLength(1);
      expect(patches()[0].url).toContain(`/v1/orders/${o.id}`);
      expect(patches()[0].body).toEqual({ status: 'accepted' });
      await statusEvent(ca, o, 'accepted');
      expect((await link(ca, o.id)).state).toBe('accepted');
      expect((await f.orderRow(co.orderId)).status).toBe('confirmed');
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(8);
    });

    it('S03 reject sends each documented reject_reason', async () => {
      for (const reason of [
        'closing_early',
        'busy',
        'ingredient_unavailable',
        'other',
      ]) {
        const { p, o } = await fresh(ca);
        await newOrder(ca, o);
        const co = await link(ca, o.id);
        calls.length = 0;
        await r()
          .post(`/channels/orders/${co.id}/reject`)
          .set(h(a))
          .send({ reason })
          .expect(201);
        expect(patches()[0].body).toEqual({
          status: 'rejected',
          reject_reason: reason,
        });
        expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
        expect(await f.productStock(ca.shop.outletId, p.id)).toBe(10);
      }
    });

    it('S04 no answer within the UAE 7-minute window: the deadline is placed + 7 min and the auto-reject cancels and restocks', async () => {
      const placed = new Date();
      const { p, o } = await fresh(ca, 10, {
        status_log: [{ status: 'placed', at: placed.toISOString() }],
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      expect(
        Math.abs(
          new Date(co.acceptBy).getTime() - (placed.getTime() + 7 * 60_000),
        ),
      ).toBeLessThan(1000);
      await statusEvent(ca, o, 'rejected');
      expect((await link(ca, o.id)).state).toBe('rejected');
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(10);
    });

    it('S05 customer cancel before accept cancels the order and restocks', async () => {
      const { p, o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      await statusEvent(ca, o, 'canceled');
      expect((await link(ca, o.id)).state).toBe('cancelled_upstream');
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(10);
    });

    it('S06 cancel after accept is acknowledged with 200 and cancels through the normal path', async () => {
      const { p, o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      const { res } = await statusEvent(ca, o, 'canceled');
      expect(res.status).toBe(200);
      expect((await f.orderRow(co.orderId)).status).toBe('cancelled');
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(10);
    });

    it('S07 scheduled order: scheduledFor is kept, no deadline is invented, accept works (the later "confirmed" step is NOT built)', async () => {
      const at = new Date(Date.now() + 86_400_000).toISOString();
      const { o } = await fresh(ca, 10, {
        asap: false,
        prepare_for: at,
        start_preparing_at: at,
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      expect(co.acceptBy).toBeNull();
      expect(new Date(co.scheduledFor).toISOString()).toBe(
        new Date(at).toISOString(),
      );
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect(patches().map((c) => c.body)).toEqual([{ status: 'accepted' }]);
    });

    it('S08 the same delivery twice (same GUID) is one inbox row and one order, both answered 200', async () => {
      const { o } = await fresh(ca);
      const first = await newOrder(ca, o);
      const again = await post(
        first.raw,
        deliverooHeaders(ca.secret, first.guid, first.raw),
      );
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ received: true });
      const rows = (await inboxRows(ca.id)).filter((x) =>
        String(x.eventId).startsWith(`${first.guid}:`),
      );
      expect(rows).toHaveLength(1);
      expect(await countLinks(ca, o.id)).toBe(1);
    });

    it('S09 a redelivery with a new GUID is accepted and still one order', async () => {
      const { p, o } = await fresh(ca);
      await newOrder(ca, o);
      expect((await newOrder(ca, o)).res.status).toBe(200);
      expect(await countLinks(ca, o.id)).toBe(1);
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(8);
    });

    it('S10 eight concurrent duplicates make one order and one stock hold', async () => {
      const { p, o } = await fresh(ca);
      const raw = webhookBody('order.new', o);
      const same = `g-c-${++gseq}`;
      const out = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          post(
            raw,
            deliverooHeaders(ca.secret, i < 4 ? same : `${same}-${i}`, raw),
          ),
        ),
      );
      expect(out.every((x) => x.status === 200)).toBe(true);
      for (let i = 0; i < 60 && (await countLinks(ca, o.id)) === 0; i++)
        await new Promise((res) => setTimeout(res, 50));
      await new Promise((res) => setTimeout(res, 400));
      expect(await countLinks(ca, o.id)).toBe(1);
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(8);
    });

    it('S11 a status event before order.new is retried, not dropped, and applies once the order exists', async () => {
      const { p, o } = await fresh(ca);
      const early = {
        ...o,
        status: 'canceled',
        items: [],
        status_log: [
          ...(o.status_log as object[]),
          { status: 'canceled', at: new Date().toISOString() },
        ],
      };
      const first = await deliver(ca, 'order.status_update', early);
      expect(first.res.status).toBe(200);
      const row = (await inboxRows(ca.id)).find((x) =>
        String(x.eventId).startsWith(`${first.guid}:`),
      );
      expect(row?.status).toBe('failed');
      await newOrder(ca, o);
      await db.execute(
        `UPDATE channelinboundevent SET nextAttemptAt = ? WHERE id = ?`,
        [new Date(Date.now() - 1000), row!.id],
      );
      await sweep.replayDue();
      expect((await link(ca, o.id)).state).toBe('cancelled_upstream');
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(10);
    });

    it('S15 a null or unknown pos_item_id keeps the order visible in needs_mapping and creates no product', async () => {
      const before = Number(
        (
          await db.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM product WHERE shopId = ?`,
            [a.shopId],
          )
        )[0].n,
      );
      const o = ord(ca, {
        items: [
          { ...line('x', 1, 1500), pos_item_id: null, name: 'Mystery bouquet' },
        ],
        total_price: aed(1500),
        subtotal: aed(1500),
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      expect(co.state).toBe('needs_mapping');
      expect(co.orderId).toBeNull();
      const list = await r().get('/channels/orders').set(h(a)).expect(200);
      const mine = list.body.data.find((x: { id: number }) => x.id === co.id);
      expect(mine.waitingItems[0]).toMatchObject({
        name: 'Mystery bouquet',
        quantity: 1,
      });
      expect(JSON.stringify(mine)).not.toContain('+971500000000');
      expect(
        Number(
          (
            await db.query<RowDataPacket[]>(
              `SELECT COUNT(*) AS n FROM product WHERE shopId = ?`,
              [a.shopId],
            )
          )[0].n,
        ),
      ).toBe(before);
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelorder:${co.id}:alert`,
        ),
      ).toHaveLength(1);
    });

    it('S16 item and basket discounts: the stated total and discount are stored, the line keeps the pre-discount price', async () => {
      const { o } = await fresh(ca, 10, {
        offer_discount: aed(500),
        total_price: aed(4500),
        subtotal: aed(5000),
      });
      (o.items as Record<string, unknown>[])[0].discount_amount = aed(200);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      const order = await f.orderRow(co.orderId);
      expect(Number(order.total)).toBe(45);
      expect(Number(order.discountAmount)).toBe(5);
      expect(Number((await f.orderItems(co.orderId))[0].priceAtPurchase)).toBe(
        25,
      );
    });

    it('S17 nested modifiers are folded into the unit price', async () => {
      const p = await f.stockedProduct(a, 10, { price: 25 });
      const id = sku();
      await mapItem(a, id, p.id);
      const o = ord(ca, {
        items: [
          {
            ...line(id, 2, 3000),
            total_price: aed(3000),
            unit_price: aed(2000),
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
        total_price: aed(6000),
        subtotal: aed(6000),
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      const item = (await f.orderItems(co.orderId))[0];
      expect(Number(item.priceAtPurchase)).toBe(30);
      expect(item.note).toBe('+ Vase, Ribbon x2');
    });

    it('S18 each fulfillment_type maps to an order type (only a merchant-delivered order can reach delivery)', async () => {
      const expected: Record<string, string> = {
        deliveroo: 'pickup',
        restaurant: 'delivery',
        customer: 'pickup',
        table_service: 'pickup',
        autonomous: 'pickup',
      };
      for (const [type, orderType] of Object.entries(expected)) {
        const { o } = await fresh(ca, 5, {
          fulfillment_type: type,
          ...(type === 'restaurant'
            ? {
                delivery: {
                  line1: 'Fake street 1',
                  city: 'Dubai',
                  customer_name: 'Sam K',
                },
              }
            : {}),
        });
        await newOrder(ca, o);
        const co = await link(ca, o.id);
        expect((await f.orderRow(co.orderId)).orderType).toBe(orderType);
      }
    });

    it('S19 AED and KWD amounts are exact (KWD keeps its third decimal)', async () => {
      const p = await f.stockedProduct(a, 10, { price: 25 });
      const id = sku();
      await mapItem(a, id, p.id);
      const o = ord(ca, {
        items: [
          {
            pos_item_id: id,
            name: 'K',
            quantity: 3,
            unit_price: kwd(10505),
            total_price: kwd(10505),
            modifiers: [],
          },
        ],
        subtotal: kwd(31515),
        total_price: kwd(31515),
        offer_discount: kwd(0),
        cash_due: kwd(0),
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      const order = await f.orderRow(co.orderId);
      expect(order.currency).toBe('KWD');
      expect(Number(order.total)).toBe(31.515);
      expect(String(order.total)).toMatch(/^31\.515(0+)?$/);
      expect(Number((await f.orderItems(co.orderId))[0].priceAtPurchase)).toBe(
        10.505,
      );
    });

    it('S20 our server fails with 5xx: Deliveroo retries the same delivery and no duplicate appears', async () => {
      const { p, o } = await fresh(ca);
      const raw = webhookBody('order.new', o);
      const guid = `g-5xx-${++gseq}`;
      const spy = jest
        .spyOn(ingestion, 'writeInbox')
        .mockRejectedValueOnce(new Error('db down'));
      const first = await post(raw, deliverooHeaders(ca.secret, guid, raw));
      spy.mockRestore();
      expect(first.status).toBe(500);
      expect(await link(ca, o.id)).toBeUndefined();
      const retry = await post(raw, deliverooHeaders(ca.secret, guid, raw));
      expect(retry.status).toBe(200);
      await settle(ca.id, guid);
      expect(await countLinks(ca, o.id)).toBe(1);
      expect(await f.productStock(ca.shop.outletId, p.id)).toBe(8);
    });

    it('S21 a total webhook outage is recovered by polling Get Orders, deterministically', async () => {
      const c = await connect(a, { outletId: await newOutlet(a) });
      const { o } = await fresh(c);
      listHandler = () => ({ status: 200, json: { orders: [o] } });
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [c.id],
      );
      await sweep.pollConnections();
      expect(
        calls.find((x) => x.url.includes('/orders?live_orders=true'))?.url,
      ).toContain('/v2/brand/FAKE-BRAND-1/restaurant/');
      expect((await link(c, o.id)).state).toBe('pending_acceptance');
      const inbox = await inboxRows(c.id);
      expect(inbox.map((x) => String(x.eventId))).toEqual([
        `poll:${o.id}:placed`,
      ]);
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [c.id],
      );
      await sweep.pollConnections();
      expect(await inboxRows(c.id)).toHaveLength(1);
      expect(await countLinks(c, o.id)).toBe(1);
    });

    it('S22 409 invalid_status_transition on accept counts as success when Deliveroo already has it accepted', async () => {
      const { o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      patchHandler = () => ({
        status: 409,
        json: { error: { code: 'invalid_status_transition' } },
      });
      orderStatus.set(o.id, 'accepted');
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect((await link(ca, o.id)).state).toBe('accepted');
    });

    it('S23 503 order_not_ready on accept is retried after Retry-After', async () => {
      const { o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      let n = 0;
      patchHandler = () =>
        ++n < 3
          ? {
              status: 503,
              json: { error: { code: 'order_not_ready' } },
              retryAfter: 3,
            }
          : { status: 204 };
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      expect(patches()).toHaveLength(3);
    });

    it('S24 the 5-per-minute-per-order limit stops the 6th status update without calling Deliveroo', async () => {
      const { o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      patchHandler = () => ({ status: 500 });
      for (let i = 0; i < 5; i++)
        await r()
          .post(`/channels/orders/${co.id}/accept`)
          .set(h(a))
          .expect(502);
      expect(patches()).toHaveLength(5);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(502);
      expect(patches()).toHaveLength(5);
      expect((await link(ca, o.id)).state).toBe('pending_acceptance');
    });

    it('S25 the token is cached, refreshed after its 300 s lifetime, and the platform credentials are used when the connection has none', async () => {
      const c = await connect(a, {
        outletId: await newOutlet(a),
        credentials: { useSandboxPlatformCredentials: 'yes' },
      });
      let now = Date.now() + 10 * 3_600_000; // beyond any token another test cached
      provider.api.now = () => now;
      const accept = async () => {
        const { o } = await fresh(c);
        await newOrder(c, o);
        const co = await link(c, o.id);
        await r()
          .post(`/channels/orders/${co.id}/accept`)
          .set(h(a))
          .expect(201);
      };
      const t0 = tokenCalls;
      await accept();
      await accept();
      expect(tokenCalls - t0).toBe(1);
      now += 290_000;
      await accept();
      expect(tokenCalls - t0).toBe(2);
    });

    it('S26 a remake order is ingested and says so', async () => {
      const { o } = await fresh(ca, 10, {
        remake_details: {
          parent_order_id: 'ae:fake-parent',
          fault: 'restaurant',
        },
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      expect((await f.orderRow(co.orderId)).deliveryNotes).toContain(
        'Remake of order ae:fake-parent',
      );
    });

    it('S27 a variable-weight item carries its final weight on the line', async () => {
      const p = await f.stockedProduct(a, 10, { price: 25 });
      const id = sku();
      await mapItem(a, id, p.id);
      const o = ord(ca, {
        items: [
          {
            ...line(id, 1, 2500),
            variable_weight: {
              is_variable_weight: true,
              final_weight: { value: 1.2, unit_of_measure: 'kg' },
            },
          },
        ],
        total_price: aed(2500),
        subtotal: aed(2500),
      });
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      expect((await f.orderItems(co.orderId))[0].note).toBe('Weight 1.2 kg');
    });

    it('S28 ready_for_collection is a human action: accepting and processing never send it, and the method posts the documented body', async () => {
      const { o } = await fresh(ca);
      await newOrder(ca, o);
      const co = await link(ca, o.id);
      await r().post(`/channels/orders/${co.id}/accept`).set(h(a)).expect(201);
      await statusEvent(ca, o, 'accepted');
      expect(calls.some((c) => c.url.includes('prep_stage'))).toBe(false);
      const bound = {
        id: ca.id,
        shopId: a.shopId,
        outletId: a.outletId,
        provider: 'deliveroo',
        externalLocationId: ca.locationId,
        externalBrandId: 'FAKE-BRAND-1',
        externalSiteId: 'FAKE-SITE-1',
        credentials: {
          clientId: FAKE_CLIENT_ID,
          clientSecret: FAKE_CLIENT_SECRET,
        },
        webhookSecret: null,
      };
      expect((await provider.markReady(bound, o.id)).ok).toBe(true);
      const c = calls.find((x) => x.url.includes('prep_stage'))!;
      expect(c.body).toMatchObject({ stage: 'ready_for_collection' });
    });

    it('S29 cash due on delivery leaves the order unpaid; a prepaid order is paid; no gateway is ever charged', async () => {
      const x = await fresh(ca, 10, { cash_due: aed(5000) });
      await newOrder(ca, x.o);
      const cx = await link(ca, x.o.id);
      expect((await f.orderRow(cx.orderId)).paymentStatus).toBe('unpaid');
      const y = await fresh(ca);
      await newOrder(ca, y.o);
      const cy = await link(ca, y.o.id);
      expect((await f.orderRow(cy.orderId)).paymentStatus).toBe('paid');
      const tx = await db.query<RowDataPacket[]>(
        `SELECT id FROM paymenttransaction WHERE orderId IN (?, ?)`,
        [cx.orderId, cy.orderId],
      );
      expect(tx).toHaveLength(0);
      await r()
        .post(`/payments/orders/${cx.orderId}/link`)
        .set(h(a))
        .expect((s) => expect(s).not.toBe(201));
    });

    it('S30 the refund webhook is NOT built: a refund-shaped delivery is refused like any unroutable one and writes nothing', async () => {
      const raw = JSON.stringify({
        event: 'refund.created',
        body: { refund_id: 'fake-refund-1', order_id: 'ae:fake' },
      });
      const before = await countInbox(ca.id, cb.id);
      const res = await post(raw, deliverooHeaders(ca.secret, 'g-rf-1', raw));
      expect(res.status).toBe(401);
      expect(await countInbox(ca.id, cb.id)).toBe(before);
    });
  });

  // ===========================================================================
  describe('operations', () => {
    it('five failed polls in a row alert the merchant once, and a good poll resets the count', async () => {
      const c = await connect(a, { outletId: await newOutlet(a) });
      await db.execute(
        `UPDATE outlet SET whatsapp = '+971501112233' WHERE id = ?`,
        [c.outletId],
      );
      listHandler = () => ({ status: 500, json: {} });
      for (let i = 0; i < 7; i++) {
        await db.execute(
          `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
          [c.id],
        );
        await sweep.pollConnections();
      }
      const row = (
        await db.query<RowDataPacket[]>(
          `SELECT pollFailures, lastSyncStatus, lastError FROM channelconnection WHERE id = ?`,
          [c.id],
        )
      )[0];
      expect(row.pollFailures).toBe(7);
      expect(row.lastSyncStatus).toBe('failed');
      expect(
        await jobsOf(
          a.shopId,
          'send_merchant_whatsapp_alert',
          `channelconn:${c.id}:poll-down:%`,
        ),
      ).toHaveLength(1);
      listHandler = () => ({ status: 200, json: { orders: [] } });
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [c.id],
      );
      await sweep.pollConnections();
      expect(
        (
          await db.query<RowDataPacket[]>(
            `SELECT pollFailures FROM channelconnection WHERE id = ?`,
            [c.id],
          )
        )[0].pollFailures,
      ).toBe(0);
    });

    it('a polled order from another location is dropped, never ingested', async () => {
      const c = await connect(a, { outletId: await newOutlet(a) });
      const foreign = ord(c, { location_id: 'FAKE-SOMEONE-ELSES-LOCATION' });
      listHandler = () => ({ status: 200, json: { orders: [foreign] } });
      await db.execute(
        `UPDATE channelconnection SET lastSyncAt = NULL WHERE id = ?`,
        [c.id],
      );
      await sweep.pollConnections();
      expect(await inboxRows(c.id)).toHaveLength(0);
    });

    it('L5 a failing poll-failure alert cannot abort the polling loop', async () => {
      const c1 = await connect(a, { outletId: await newOutlet(a) });
      const c2 = await connect(a, { outletId: await newOutlet(a) });
      listHandler = () => ({ status: 500, json: {} });
      const spy = jest
        .spyOn(
          sweep as unknown as { escalatePollFailure: () => Promise<void> },
          'escalatePollFailure',
        )
        .mockRejectedValue(new Error('alert failed'));
      try {
        await db.execute(
          `UPDATE channelconnection SET lastSyncAt = NULL WHERE id IN (?, ?)`,
          [c1.id, c2.id],
        );
        await expect(sweep.pollConnections()).resolves.toBeDefined();
        expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
        for (const c of [c1, c2]) {
          const row = (
            await db.query<RowDataPacket[]>(
              `SELECT lastSyncStatus, pollFailures FROM channelconnection WHERE id = ?`,
              [c.id],
            )
          )[0];
          expect(row.lastSyncStatus).toBe('failed');
          expect(row.pollFailures).toBe(1);
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('turning the platform flag off does not stop an enabled connection from receiving', async () => {
      const c = await connect(b, { outletId: await newOutlet(b) });
      await db.execute(
        `UPDATE shopfeatureoverride SET enabled = 0 WHERE shopId = ? AND featureKey = 'marketplace_channels'`,
        [b.shopId],
      );
      try {
        expect((await newOrder(c, ord(c))).res.status).toBe(200);
      } finally {
        await grantFlag(b);
      }
    });
  });

  // Keep last: it exhausts the per-IP bucket of this route.
  describe('throttle', () => {
    it('the route is rate limited per source IP (forged deliveries cannot flood it)', async () => {
      process.env.THROTTLE_IN_TESTS = '1';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 250; i++)
          statuses.push(
            (
              await r()
                .post('/channels/deliveroo/webhook')
                .set('content-type', 'application/json')
                .send('{}')
            ).status,
          );
        expect(statuses[0]).toBe(401);
        expect(statuses).toContain(429);
      } finally {
        delete process.env.THROTTLE_IN_TESTS;
      }
    });
  });
});

// keeps the unused-import linter quiet for helpers only some tests need
void signDeliveroo;
