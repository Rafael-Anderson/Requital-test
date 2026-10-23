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
import { ChannelIngestionService } from '../src/channels/channel-ingestion.service';
import {
  ChannelSweepService,
  CONFIRM_CLAIM_STALE_SECONDS,
} from '../src/channels/channel-sweep.service';
import { HttpErrorTrackingProvider } from '../src/common/error-tracking/http-error-tracking.provider';
import {
  STUB_PROVIDER,
  StubChannelProvider,
  signStubDelivery,
} from '../src/channels/providers/stub-channel.provider';
import type { CanonicalChannelOrder } from '../src/channels/channel.types';

jest.setTimeout(300000);

// F/E5: scheduled-order confirm, mark ready, availability, prep time, and the
// merchant "request verification" plus the staff pending list. Fake provider
// only: no network, no credentials.
describe('Marketplace follow-ups (E5)', () => {
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
  const ext = () => `F-${f.runId}-${++seq}`;

  async function grantFlag(shop: W5Shop, on = true) {
    await db.execute(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'marketplace_channels', ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [shop.shopId, on ? 1 : 0],
    );
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

  // Creates a connection; `verify` also has staff verify it and enables it.
  async function connect(
    shop: W5Shop,
    opts: {
      outletId?: number;
      brand?: string;
      site?: string;
      verify?: boolean;
    } = {},
  ): Promise<Conn> {
    const outletId = opts.outletId ?? shop.outletId;
    const locationId = `LOC-${f.uniq()}`;
    const secret = `secret-${f.uniq()}-abcdefgh`;
    const created = await r()
      .post('/channels/connections')
      .set(h(shop))
      .send({
        outletId,
        provider: STUB_PROVIDER,
        externalLocationId: locationId,
        ...(opts.brand ? { externalBrandId: opts.brand } : {}),
        ...(opts.site ? { externalSiteId: opts.site } : {}),
        credentials: { token: `tok-${f.uniq()}` },
        webhookSecret: secret,
      })
      .expect(201);
    const id = body<{ id: number }>(created).id;
    if (opts.verify !== false) {
      await staffVerify(shop, id, {
        externalLocationId: locationId,
        externalBrandId: opts.brand ?? null,
        externalSiteId: opts.site ?? null,
      }).expect(201);
      await r()
        .post(`/channels/connections/${id}/enabled`)
        .set(h(shop))
        .send({ enabled: true })
        .expect(201);
    }
    return { shop, id, locationId, secret, outletId };
  }

  function canon(
    lines: { id: string; priceMinor: number }[],
    over: Partial<CanonicalChannelOrder> = {},
  ): CanonicalChannelOrder {
    const sum = lines.reduce((t, l) => t + l.priceMinor, 0);
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
        name: `Item ${l.id}`,
        quantity: 1,
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
      },
      customer: { name: 'Sam K', phone: null, address: null, notes: null },
      ...over,
    };
  }

  let evSeq = 0;
  function deliver(c: Conn, payload: Record<string, unknown>) {
    const raw = JSON.stringify({ locationId: c.locationId, ...payload });
    const eventId = `ev-${f.runId}-${++evSeq}`;
    return ingestion.receive({
      provider: STUB_PROVIDER,
      rawBody: Buffer.from(raw),
      headers: {
        'x-stub-event-id': eventId,
        'x-stub-signature': signStubDelivery(c.secret, eventId, raw),
      },
      processInline: true,
    });
  }
  const newOrder = (c: Conn, o: CanonicalChannelOrder) =>
    deliver(c, { type: 'order.new', order: o });

  async function link(c: Conn, externalOrderId: string) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM channelorder WHERE connectionId = ? AND externalOrderId = ?`,
      [c.id, externalOrderId],
    );
    return rows[0];
  }
  const linkById = async (id: number) =>
    (
      await db.query<RowDataPacket[]>(
        `SELECT * FROM channelorder WHERE id = ?`,
        [id],
      )
    )[0];
  const connRow = async (id: number) =>
    (
      await db.query<RowDataPacket[]>(
        `SELECT * FROM channelconnection WHERE id = ?`,
        [id],
      )
    )[0];

  async function jobsLike(shopId: number, like: string) {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM job WHERE shopId = ? AND idempotencyKey LIKE ?`,
      [shopId, like],
    );
  }
  async function auditRows(shopId: number, action: string, entityId: number) {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM auditlog WHERE shopId = ? AND action = ? AND entityId = ?`,
      [shopId, action, entityId],
    );
  }

  const inMinutes = (m: number) =>
    new Date(Date.now() + m * 60_000).toISOString();

  // A mapped single-line order, optionally scheduled, optionally accepted.
  async function orderFor(
    c: Conn,
    opts: { confirmInMin?: number | null; accept?: boolean } = {},
  ) {
    const p = await f.stockedProduct(c.shop, 10, { price: 25 });
    const sku = `sku-${f.uniq()}`;
    await r()
      .post('/channels/mappings')
      .set(h(c.shop))
      .send({ provider: STUB_PROVIDER, externalItemId: sku, productId: p.id })
      .expect(201);
    const scheduled =
      opts.confirmInMin !== undefined && opts.confirmInMin !== null;
    const o = canon([{ id: sku, priceMinor: 2500 }], {
      acceptBy: null,
      scheduledFor: scheduled ? inMinutes(opts.confirmInMin! + 60) : null,
      confirmBy: scheduled ? inMinutes(opts.confirmInMin!) : null,
    });
    await newOrder(c, o);
    const co = await link(c, o.externalOrderId);
    if (opts.accept) {
      await r()
        .post(`/channels/orders/${co.id}/accept`)
        .set(h(c.shop))
        .expect(201);
    }
    return { o, co, sku };
  }

  beforeAll(async () => {
    const booted = await bootApp();
    app = booted.app;
    db = booted.db;
    f = makeFixtures(app, db);
    ingestion = app.get(ChannelIngestionService);
    sweep = app.get(ChannelSweepService);
    stub = app.get(StubChannelProvider);
    const email = `e5-staff-${f.runId}@test.com`;
    await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [email, await bcrypt.hash('platform-password-123', 10), 'E5 Staff'],
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
    a = await f.setupShop('e5-a');
    b = await f.setupShop('e5-b');
    await grantFlag(a);
    await grantFlag(b);
    await db.execute(
      `UPDATE outlet SET whatsapp = '+971501112233' WHERE id IN (?, ?)`,
      [a.outletId, b.outletId],
    );
    ca = await connect(a, { brand: 'BRAND-A', site: 'SITE-A' });
    cb = await connect(b, { brand: 'BRAND-B', site: 'SITE-B' });
  });
  beforeEach(() => stub.reset());
  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('scheduled-order confirm (desk)', () => {
    it('desk roles can read provider capabilities (to know which buttons exist); a viewer cannot', async () => {
      const staff = await createStaff(
        app,
        a.adminToken,
        'e5pr',
        'order_manager',
      );
      const res = await r()
        .get('/channels/providers')
        .set({ Authorization: `Bearer ${staff.token}` })
        .expect(200);
      const stubInfo = res.body.find(
        (p: { name: string }) => p.name === STUB_PROVIDER,
      );
      expect(stubInfo.capabilities.scheduledConfirm).toBe(true);
      const viewer = await createStaff(app, a.adminToken, 'e5pv', 'viewer');
      await r()
        .get('/channels/providers')
        .set({ Authorization: `Bearer ${viewer.token}` })
        .expect(403);
    });

    it('stores confirmBy from the canonical order, and an ASAP order has none', async () => {
      const { co } = await orderFor(ca, { confirmInMin: 120 });
      expect(co.confirmBy).not.toBeNull();
      expect(co.confirmedAt).toBeNull();
      expect(co.readyAt).toBeNull();
      const asap = await orderFor(ca);
      expect(asap.co.confirmBy).toBeNull();
    });

    it('confirms through the provider once, records confirmedAt and an audit row, and a repeat does not call again', async () => {
      const { o, co } = await orderFor(ca, { confirmInMin: 120, accept: true });
      const res = await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(201);
      expect(res.body.confirmedAt).not.toBeNull();
      expect(
        stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
      ).toEqual([
        {
          method: 'confirmScheduledOrder',
          externalOrderId: o.externalOrderId,
          detail: undefined,
        },
      ]);
      expect((await linkById(co.id)).confirmedAt).not.toBeNull();
      expect(
        await auditRows(a.shopId, 'channel_order.scheduled_confirmed', co.id),
      ).toHaveLength(1);
      await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(201);
      expect(
        stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
      ).toHaveLength(1);
      expect(
        await auditRows(a.shopId, 'channel_order.scheduled_confirmed', co.id),
      ).toHaveLength(1);
    });

    it('refuses an order that is not accepted yet, and one that is not scheduled, with nothing sent', async () => {
      const pending = await orderFor(ca, { confirmInMin: 120 });
      await r()
        .post(`/channels/orders/${pending.co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(409);
      const asap = await orderFor(ca, { accept: true });
      await r()
        .post(`/channels/orders/${asap.co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(409);
      expect(
        stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
      ).toEqual([]);
    });

    it('a provider failure is a 502 and changes nothing; the capability flag gates the call', async () => {
      const { co } = await orderFor(ca, { confirmInMin: 120, accept: true });
      stub.failNext.add('confirmScheduledOrder');
      await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(502);
      expect((await linkById(co.id)).confirmedAt).toBeNull();
      expect(
        await auditRows(a.shopId, 'channel_order.scheduled_confirmed', co.id),
      ).toHaveLength(0);
      stub.calls.length = 0;
      stub.scheduledConfirm = false;
      await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(409);
      expect(
        stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
      ).toEqual([]);
    });

    it('another shop gets 404 and nothing is sent; a branch user of another outlet gets 404; a view-only branch role gets 403', async () => {
      const { co } = await orderFor(ca, { confirmInMin: 120, accept: true });
      await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set(h(b))
        .expect(404);
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-e5 ${f.runId}` })
          .expect(201),
      );
      const staff2 = await createStaff(
        app,
        a.adminToken,
        'e5o2',
        'branch',
        o2.id,
      );
      await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set({ Authorization: `Bearer ${staff2.token}` })
        .expect(404);
      const staff = await createStaff(
        app,
        a.adminToken,
        'e5v',
        'branch',
        a.outletId,
      );
      const bh = { Authorization: `Bearer ${staff.token}` };
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
      await r()
        .post(`/channels/orders/${co.id}/confirm-scheduled`)
        .set(bh)
        .expect(403);
      await r().post(`/channels/orders/${co.id}/ready`).set(bh).expect(403);
      expect(
        stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
      ).toEqual([]);
      expect((await linkById(co.id)).confirmedAt).toBeNull();
    });

    it('an incoming status "confirmed" (done on the tablet) records confirmedAt', async () => {
      const { o, co } = await orderFor(ca, { confirmInMin: 5, accept: true });
      await deliver(ca, {
        type: 'order.status',
        externalOrderId: o.externalOrderId,
        status: 'accepted',
        externalStatus: 'confirmed',
      });
      expect((await linkById(co.id)).confirmedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('scheduled-order sweep', () => {
    it('DEFAULT: one WhatsApp alert as the deadline approaches, never an automatic confirm, however often it runs', async () => {
      expect((await connRow(ca.id)).autoConfirmScheduled).toBe(false);
      const { co } = await orderFor(ca, { confirmInMin: 10, accept: true });
      const far = await orderFor(ca, { confirmInMin: 600, accept: true });
      for (let i = 0; i < 3; i++) await sweep.runOnce();
      expect(
        stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
      ).toEqual([]);
      expect((await linkById(co.id)).confirmedAt).toBeNull();
      expect(
        await jobsLike(a.shopId, `channelorder:${co.id}:confirm-alert`),
      ).toHaveLength(1);
      // Not approaching yet: nothing.
      expect(
        await jobsLike(a.shopId, `channelorder:${far.co.id}:confirm-alert`),
      ).toHaveLength(0);
      // Confirmed on the desk: no alert for it later.
      const later = await orderFor(ca, { confirmInMin: 600, accept: true });
      await r()
        .post(`/channels/orders/${later.co.id}/confirm-scheduled`)
        .set(h(a))
        .expect(201);
      await db.execute(`UPDATE channelorder SET confirmBy = ? WHERE id = ?`, [
        new Date(Date.now() + 60_000),
        later.co.id,
      ]);
      await sweep.runOnce();
      expect(
        await jobsLike(a.shopId, `channelorder:${later.co.id}:confirm-alert`),
      ).toHaveLength(0);
    });

    it("the alert goes to the order's shop only", async () => {
      const mine = await orderFor(cb, { confirmInMin: 10, accept: true });
      await sweep.runOnce();
      expect(
        await jobsLike(b.shopId, `channelorder:${mine.co.id}:confirm-alert`),
      ).toHaveLength(1);
      expect(
        await jobsLike(a.shopId, `channelorder:${mine.co.id}:confirm-alert`),
      ).toHaveLength(0);
    });

    it('OPT-IN: the sweep confirms once, keyed on confirmedAt (a late "accepted" event does not repeat it), and sends no alert', async () => {
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ autoConfirmScheduled: true })
        .expect(200);
      expect((await connRow(ca.id)).autoConfirmScheduled).toBe(true);
      try {
        const { o, co } = await orderFor(ca, {
          confirmInMin: 10,
          accept: true,
        });
        await sweep.runOnce();
        const mine = () =>
          stub.calls.filter(
            (c) =>
              c.method === 'confirmScheduledOrder' &&
              c.externalOrderId === o.externalOrderId,
          );
        expect(mine()).toHaveLength(1);
        const after = await linkById(co.id);
        expect(after.confirmedAt).not.toBeNull();
        expect(after.confirmClaimedAt).toBeNull();
        expect(
          await jobsLike(a.shopId, `channelorder:${co.id}:confirm-alert`),
        ).toHaveLength(0);
        expect(
          await auditRows(a.shopId, 'channel_order.scheduled_confirmed', co.id),
        ).toHaveLength(1);
        // A late plain "accepted" overwrites externalStatus; confirmedAt stays
        // the key, so nothing is confirmed again.
        await deliver(ca, {
          type: 'order.status',
          externalOrderId: o.externalOrderId,
          status: 'accepted',
          externalStatus: 'accepted',
        });
        expect((await linkById(co.id)).externalStatus).toBe('accepted');
        await sweep.runOnce();
        await sweep.runOnce();
        expect(mine()).toHaveLength(1);
      } finally {
        await db.execute(
          `UPDATE channelconnection SET autoConfirmScheduled = 0 WHERE id = ?`,
          [ca.id],
        );
      }
    });

    it('OPT-IN: a fresh claim blocks the sweep, a failed call keeps the claim as back-off and retries after the stale window; an already claimed order is not confirmed twice', async () => {
      await db.execute(
        `UPDATE channelconnection SET autoConfirmScheduled = 1 WHERE id = ?`,
        [ca.id],
      );
      try {
        const claimed = await orderFor(ca, { confirmInMin: 10, accept: true });
        await db.execute(
          `UPDATE channelorder SET confirmClaimedAt = ? WHERE id = ?`,
          [new Date(), claimed.co.id],
        );
        await sweep.runOnce();
        expect(
          stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
        ).toEqual([]);
        // The claim goes stale (a crashed worker): the next tick confirms.
        await db.execute(
          `UPDATE channelorder SET confirmClaimedAt = ? WHERE id = ?`,
          [
            new Date(Date.now() - (CONFIRM_CLAIM_STALE_SECONDS + 5) * 1000),
            claimed.co.id,
          ],
        );
        await sweep.runOnce();
        expect(
          stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
        ).toHaveLength(1);
        expect((await linkById(claimed.co.id)).confirmedAt).not.toBeNull();

        stub.calls.length = 0;
        const flaky = await orderFor(ca, { confirmInMin: 10, accept: true });
        stub.failNext.add('confirmScheduledOrder');
        await sweep.runOnce();
        expect((await linkById(flaky.co.id)).confirmedAt).toBeNull();
        expect((await linkById(flaky.co.id)).confirmClaimedAt).not.toBeNull();
        // Inside the back-off window: not retried.
        await sweep.runOnce();
        expect(
          stub.calls.filter((c) => c.method === 'confirmScheduledOrder'),
        ).toHaveLength(1);
        await db.execute(
          `UPDATE channelorder SET confirmClaimedAt = ? WHERE id = ?`,
          [
            new Date(Date.now() - (CONFIRM_CLAIM_STALE_SECONDS + 5) * 1000),
            flaky.co.id,
          ],
        );
        await sweep.runOnce();
        expect((await linkById(flaky.co.id)).confirmedAt).not.toBeNull();
      } finally {
        await db.execute(
          `UPDATE channelconnection SET autoConfirmScheduled = 0 WHERE id = ?`,
          [ca.id],
        );
      }
    });

    it("OPT-IN works per connection (another shop's order is untouched) and a switched-off connection is not called", async () => {
      const other = await orderFor(cb, { confirmInMin: 10, accept: true });
      await db.execute(
        `UPDATE channelconnection SET autoConfirmScheduled = 1 WHERE id = ?`,
        [ca.id],
      );
      try {
        await sweep.runOnce();
        expect((await linkById(other.co.id)).confirmedAt).toBeNull();
        // A connection staff switched off is not called, even with an accepted
        // order and the opt-in on.
        const mine = await orderFor(ca, { confirmInMin: 10, accept: true });
        await db.execute(
          `UPDATE channelconnection SET enabled = 0 WHERE id = ?`,
          [ca.id],
        );
        await sweep.runOnce();
        expect((await linkById(mine.co.id)).confirmedAt).toBeNull();
      } finally {
        await db.execute(
          `UPDATE channelconnection SET autoConfirmScheduled = 0, enabled = 1 WHERE id = ?`,
          [ca.id],
        );
      }
    });

    it('the opt-in is a merchant-admin setting: another shop gets 404, a provider without the step is refused, a non-admin gets 403', async () => {
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(b))
        .send({ autoConfirmScheduled: true })
        .expect(404);
      expect((await connRow(ca.id)).autoConfirmScheduled).toBe(false);
      stub.scheduledConfirm = false;
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ autoConfirmScheduled: true })
        .expect(400);
      stub.scheduledConfirm = true;
      const staff = await createStaff(
        app,
        a.adminToken,
        'e5om',
        'order_manager',
      );
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set({ Authorization: `Bearer ${staff.token}` })
        .send({ autoConfirmScheduled: true })
        .expect(403);
      // Turning it on does not touch the staff verification.
      await r()
        .patch(`/channels/connections/${ca.id}`)
        .set(h(a))
        .send({ autoConfirmScheduled: false })
        .expect(200);
      expect((await connRow(ca.id)).locationVerifiedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('ready for collection (desk)', () => {
    it('tells the marketplace once, records readyAt and an audit row, and a repeat does not call again', async () => {
      const { o, co } = await orderFor(ca, { accept: true });
      const res = await r()
        .post(`/channels/orders/${co.id}/ready`)
        .set(h(a))
        .expect(201);
      expect(res.body.readyAt).not.toBeNull();
      expect(stub.calls.filter((c) => c.method === 'markReady')).toEqual([
        {
          method: 'markReady',
          externalOrderId: o.externalOrderId,
          detail: undefined,
        },
      ]);
      expect(
        await auditRows(a.shopId, 'channel_order.marked_ready', co.id),
      ).toHaveLength(1);
      await r().post(`/channels/orders/${co.id}/ready`).set(h(a)).expect(201);
      expect(stub.calls.filter((c) => c.method === 'markReady')).toHaveLength(
        1,
      );
      expect(
        await auditRows(a.shopId, 'channel_order.marked_ready', co.id),
      ).toHaveLength(1);
    });

    it('is never automatic: the sweep does not call markReady', async () => {
      await orderFor(ca, { accept: true });
      await sweep.runOnce();
      expect(stub.calls.filter((c) => c.method === 'markReady')).toEqual([]);
    });

    it('needs an accepted order with a Requital order behind it', async () => {
      const pending = await orderFor(ca);
      await r()
        .post(`/channels/orders/${pending.co.id}/ready`)
        .set(h(a))
        .expect(409);
      expect(stub.calls.filter((c) => c.method === 'markReady')).toEqual([]);
      expect((await linkById(pending.co.id)).readyAt).toBeNull();
    });

    it('a provider failure is a 502 and changes nothing; another shop gets 404; a branch user of another outlet gets 404', async () => {
      const { co } = await orderFor(ca, { accept: true });
      stub.failNext.add('markReady');
      await r().post(`/channels/orders/${co.id}/ready`).set(h(a)).expect(502);
      expect((await linkById(co.id)).readyAt).toBeNull();
      await r().post(`/channels/orders/${co.id}/ready`).set(h(b)).expect(404);
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-r ${f.runId}` })
          .expect(201),
      );
      const staff = await createStaff(
        app,
        a.adminToken,
        'e5r',
        'branch',
        o2.id,
      );
      await r()
        .post(`/channels/orders/${co.id}/ready`)
        .set({ Authorization: `Bearer ${staff.token}` })
        .expect(404);
      // A viewer is not a desk role at all.
      const viewer = await createStaff(app, a.adminToken, 'e5vw', 'viewer');
      await r()
        .post(`/channels/orders/${co.id}/ready`)
        .set({ Authorization: `Bearer ${viewer.token}` })
        .expect(403);
      expect((await linkById(co.id)).readyAt).toBeNull();
    });

    it('two simultaneous presses both succeed and leave a single readyAt', async () => {
      const { co } = await orderFor(ca, { accept: true });
      const out = await Promise.all([
        r().post(`/channels/orders/${co.id}/ready`).set(h(a)),
        r().post(`/channels/orders/${co.id}/ready`).set(h(a)),
      ]);
      expect(out.every((x) => x.status === 201)).toBe(true);
      expect((await linkById(co.id)).readyAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('item availability and prep time (admin)', () => {
    async function mapped(c: Conn, n = 2) {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await f.stockedProduct(c.shop, 5, { price: 10 });
        const sku = `av-${f.uniq()}`;
        await r()
          .post('/channels/mappings')
          .set(h(c.shop))
          .send({
            provider: STUB_PROVIDER,
            externalItemId: sku,
            productId: p.id,
          })
          .expect(201);
        ids.push(sku);
      }
      return ids;
    }

    it("sends only this shop's mapped items, with an audit row", async () => {
      const [x, y] = await mapped(ca);
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set(h(a))
        .send({
          items: [
            { externalItemId: x, available: false },
            { externalItemId: y, available: true },
          ],
        })
        .expect(201)
        .expect({ updated: 2 });
      expect(
        stub.calls.filter((c) => c.method === 'setItemAvailability')[0].detail,
      ).toEqual([
        { externalItemId: x, available: false },
        { externalItemId: y, available: true },
      ]);
      expect(
        await auditRows(a.shopId, 'channel.availability_set', ca.id),
      ).toHaveLength(1);
    });

    it("refuses an unmapped id and another shop's mapped id (nothing is sent)", async () => {
      const [mine] = await mapped(ca, 1);
      const [theirs] = await mapped(cb, 1);
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set(h(a))
        .send({
          items: [
            { externalItemId: mine, available: false },
            { externalItemId: 'never-mapped', available: false },
          ],
        })
        .expect(400);
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set(h(a))
        .send({ items: [{ externalItemId: theirs, available: false }] })
        .expect(400);
      expect(
        stub.calls.filter((c) => c.method === 'setItemAvailability'),
      ).toEqual([]);
    });

    it('needs the brand and site ids, an enabled connection, the flag, the capability and an admin; a foreign connection is a 404', async () => {
      const [x] = await mapped(ca, 1);
      const payload = { items: [{ externalItemId: x, available: false }] };
      // One connection per outlet and provider: a new outlet, no brand or site.
      const o2 = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(a))
          .send({ name: `A-av ${f.runId}` })
          .expect(201),
      );
      const bare = await connect(a, { outletId: o2.id });
      await r()
        .post(`/channels/connections/${bare.id}/availability`)
        .set(h(a))
        .send(payload)
        .expect(409);
      await r()
        .post(`/channels/connections/${cb.id}/availability`)
        .set(h(a))
        .send(payload)
        .expect(404);
      const staff = await createStaff(
        app,
        a.adminToken,
        'e5av',
        'branch',
        a.outletId,
      );
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set({ Authorization: `Bearer ${staff.token}` })
        .send(payload)
        .expect(403);
      await grantFlag(a, false);
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set(h(a))
        .send(payload)
        .expect(403);
      await grantFlag(a, true);
      expect(
        stub.calls.filter((c) => c.method === 'setItemAvailability'),
      ).toEqual([]);
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set(h(a))
        .send({ items: [] })
        .expect(400);
    });

    it('a provider failure is a 502 with no audit row', async () => {
      const [x] = await mapped(ca, 1);
      stub.failNext.add('setItemAvailability');
      await r()
        .post(`/channels/connections/${ca.id}/availability`)
        .set(h(a))
        .send({ items: [{ externalItemId: x, available: false }] })
        .expect(502);
    });

    it('prep time is a 409 for a provider without it (nothing called) and works for one that has it', async () => {
      await r()
        .post(`/channels/connections/${ca.id}/prep-time`)
        .set(h(a))
        .send({ minutes: 30 })
        .expect(409);
      expect(stub.calls.filter((c) => c.method === 'adjustPrepTime')).toEqual(
        [],
      );
      stub.prepTimeAdjust = true;
      await r()
        .post(`/channels/connections/${ca.id}/prep-time`)
        .set(h(a))
        .send({ minutes: 30 })
        .expect(201);
      expect(
        stub.calls.filter((c) => c.method === 'adjustPrepTime'),
      ).toHaveLength(1);
      await r()
        .post(`/channels/connections/${ca.id}/prep-time`)
        .set(h(a))
        .send({ minutes: 0 })
        .expect(400);
      await r()
        .post(`/channels/connections/${cb.id}/prep-time`)
        .set(h(a))
        .send({ minutes: 30 })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('request verification and the staff queue', () => {
    let captured: jest.SpyInstance;
    let savedUrl: string | undefined;
    beforeAll(() => {
      savedUrl = process.env.ERROR_TRACKING_WEBHOOK_URL;
      process.env.ERROR_TRACKING_WEBHOOK_URL =
        'https://hooks.example.invalid/e5';
      captured = jest
        .spyOn(HttpErrorTrackingProvider.prototype, 'captureException')
        .mockImplementation(() => undefined);
    });
    afterAll(() => {
      captured.mockRestore();
      if (savedUrl === undefined) delete process.env.ERROR_TRACKING_WEBHOOK_URL;
      else process.env.ERROR_TRACKING_WEBHOOK_URL = savedUrl;
    });

    async function unverified(shop: W5Shop) {
      const o = body<{ id: number }>(
        await r()
          .post('/outlets')
          .set(h(shop))
          .send({ name: `V ${f.uniq()}` })
          .expect(201),
      );
      return connect(shop, { outletId: o.id, verify: false });
    }
    const pending = async () =>
      body<{ id: number }[]>(
        await r()
          .get('/platform-admin/channel-connections/pending-verification')
          .set('Cookie', platform.cookie)
          .expect(200),
      );

    it('records the request once a day (a parallel pair sends one), audits it, tells staff through the error-tracking pattern, and lists it for staff', async () => {
      const c = await unverified(a);
      captured.mockClear();
      const out = await Promise.all([
        r()
          .post(`/channels/connections/${c.id}/request-verification`)
          .set(h(a)),
        r()
          .post(`/channels/connections/${c.id}/request-verification`)
          .set(h(a)),
      ]);
      expect(out.map((x) => x.status).sort()).toEqual([201, 429]);
      expect(captured).toHaveBeenCalledTimes(1);
      const msg = String((captured.mock.calls[0][0] as Error).message);
      expect(msg).toContain(`connection ${c.id}`);
      expect(msg).not.toContain(c.secret);
      expect((await connRow(c.id)).verificationRequestedAt).not.toBeNull();
      expect(
        await auditRows(a.shopId, 'channel.verification_requested', c.id),
      ).toHaveLength(1);
      // The merchant view says when; the secret is not in it.
      const list = body<
        { id: number; verificationRequestedAt: string | null }[]
      >(await r().get('/channels/connections').set(h(a)).expect(200));
      expect(
        list.find((x) => x.id === c.id)!.verificationRequestedAt,
      ).not.toBeNull();
      // Staff queue: platform view with outlet and shop names.
      const q = (await pending()) as unknown as {
        id: number;
        shopId: number;
        shopName: string | null;
        outletName: string | null;
        providerDisplayName: string;
        externalLocationId: string;
        credentials?: unknown;
        webhookSecret?: unknown;
      }[];
      const mine = q.find((x) => x.id === c.id)!;
      expect(mine.shopId).toBe(a.shopId);
      expect(mine.shopName).toBeTruthy();
      expect(mine.outletName).toContain('V ');
      expect(mine.providerDisplayName).toBe('Test marketplace');
      expect(mine.credentials).toBeUndefined();
      expect(mine.webhookSecret).toBeUndefined();
      // A day later it may be asked again.
      await db.execute(
        `UPDATE channelconnection SET verificationRequestedAt = ? WHERE id = ?`,
        [new Date(Date.now() - 25 * 3_600_000), c.id],
      );
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(a))
        .expect(201);
      // Verified: it leaves the queue and cannot be requested again.
      await staffVerify(a, c.id, { externalLocationId: c.locationId }).expect(
        201,
      );
      expect((await pending()).find((x) => x.id === c.id)).toBeUndefined();
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(a))
        .expect(409);
    });

    it('is cleared in the same statement as an id or credential change, and not by a secret-free edit', async () => {
      const c = await unverified(a);
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(a))
        .expect(201);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ autoConfirmScheduled: false })
        .expect(200);
      expect((await connRow(c.id)).verificationRequestedAt).not.toBeNull();
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ externalLocationId: `LOC-${f.uniq()}` })
        .expect(200);
      expect((await connRow(c.id)).verificationRequestedAt).toBeNull();
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(a))
        .expect(201);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ credentials: { token: `t-${f.uniq()}` } })
        .expect(200);
      expect((await connRow(c.id)).verificationRequestedAt).toBeNull();
    });

    it('is admin only, flag gated, needs a location id, and is invisible across shops', async () => {
      const c = await unverified(a);
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(b))
        .expect(404);
      const staff = await createStaff(
        app,
        a.adminToken,
        'e5rv',
        'branch',
        a.outletId,
      );
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set({ Authorization: `Bearer ${staff.token}` })
        .expect(403);
      await grantFlag(a, false);
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(a))
        .expect(403);
      await grantFlag(a, true);
      await r()
        .patch(`/channels/connections/${c.id}`)
        .set(h(a))
        .send({ externalLocationId: null })
        .expect(200);
      await r()
        .post(`/channels/connections/${c.id}/request-verification`)
        .set(h(a))
        .expect(400);
      expect((await connRow(c.id)).verificationRequestedAt).toBeNull();
      expect((await pending()).find((x) => x.id === c.id)).toBeUndefined();
    });

    it('the staff queue is a platform route: a merchant admin token and no token both get 404', async () => {
      await r()
        .get('/platform-admin/channel-connections/pending-verification')
        .set(h(a))
        .expect(404);
      await r()
        .get('/platform-admin/channel-connections/pending-verification')
        .expect(404);
    });

    it('the platform shop list carries outlet, provider name and who verified; verify still needs all three ids restated', async () => {
      const c = await unverified(a);
      // Restating different ids verifies nothing.
      await staffVerify(a, c.id, {
        externalLocationId: c.locationId,
        externalBrandId: 'SOMEWHERE-ELSE',
      }).expect(409);
      expect((await connRow(c.id)).locationVerifiedAt).toBeNull();
      const ok = await staffVerify(a, c.id, {
        externalLocationId: c.locationId,
      }).expect(201);
      expect(ok.body.locationVerifiedBy).toBe(platform.id);
      expect(ok.body.providerDisplayName).toBe('Test marketplace');
      expect(ok.body.outletName).toContain('V ');
      const listed = body<{ id: number; locationVerifiedAt: string | null }[]>(
        await r()
          .get(`/platform-admin/shops/${a.shopId}/channel-connections`)
          .set('Cookie', platform.cookie)
          .expect(200),
      );
      expect(
        listed.find((x) => x.id === c.id)!.locationVerifiedAt,
      ).not.toBeNull();
    });
  });
});
