import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import type { DatabaseService } from '../src/database/database.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { LoyaltyService } from '../src/loyalty/loyalty.service';
import { ProductsService } from '../src/products/products.service';
import { body, bootApp, makeFixtures } from './helpers/w5-fixture';
import {
  asCustomer,
  registerCustomer,
  type CustomerSession,
} from './helpers/customer-session';

jest.setTimeout(240000);

// CUS-5 loyalty (earn + clawback live behind the flag; redeem built, off by
// default). Each guarantee has an injection proof in the hand-off report.
describe('Loyalty (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let f: ReturnType<typeof makeFixtures>;
  let worker: JobsWorkerService;
  let loyalty: LoyaltyService;
  let seq = 0;
  const phone = () =>
    `05${String(Date.now() % 100000)}${String(++seq).padStart(3, '0')}`;
  const server = () => app.getHttpServer();
  // Orders attach to a customer by the phone typed at checkout.
  const phones = new Map<number, string>();

  beforeAll(async () => {
    ({ app, db } = await bootApp());
    f = makeFixtures(app, db);
    worker = app.get(JobsWorkerService);
    loyalty = app.get(LoyaltyService);
  });
  afterAll(async () => {
    await app.close();
  });

  type Shop = Awaited<ReturnType<typeof f.setupShop>>;
  const admin = (
    shop: Shop,
    method: 'get' | 'post' | 'put',
    path: string,
    data?: object,
  ) =>
    request(server())
      [method](path)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send(data);

  const override = (shopId: number, key: string, enabled = 1) =>
    db.execute(
      `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, ?, ?)`,
      [shopId, key, enabled],
    );

  async function setup(
    prefix: string,
    opts: { flag?: boolean; program?: object | null; price?: number } = {},
  ) {
    const shop = await f.setupShop(prefix);
    const product = await f.stockedProduct(shop, 200, {
      price: opts.price ?? 100,
    });
    await f.publish(shop);
    const p = phone();
    const customer = await registerCustomer(
      server(),
      shop.slug,
      p,
      `loy-${f.uniq()}@x.test`,
    );
    phones.set(customer.customerId, p);
    if (opts.flag !== false) await override(shop.shopId, 'loyalty');
    if (opts.program !== null && opts.flag !== false) {
      await admin(shop, 'put', '/loyalty/program', {
        enabled: true,
        earnRate: '1',
        ...(opts.program ?? {}),
      }).expect(200);
    }
    return { shop, product, customer };
  }

  function checkout(
    shop: Shop,
    sess: CustomerSession | null,
    productId: number,
    qty = 1,
    extra: Record<string, unknown> = {},
  ) {
    const payload = {
      outletId: shop.outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'Loyal Customer',
      customerPhone: sess ? phones.get(sess.customerId) : phone(),
      customerAddress: 'Pickup',
      items: [{ productId, quantity: qty }],
      ...extra,
    };
    const path = `/public/${shop.slug}/orders`;
    return sess
      ? asCustomer(server(), sess, 'post', path).send(payload)
      : request(server()).post(path).send(payload);
  }

  async function delivered(
    shop: Shop,
    sess: CustomerSession | null,
    productId: number,
    qty = 1,
  ) {
    const res = await checkout(shop, sess, productId, qty).expect(201);
    const id = body<{ order: { id: number } }>(res).order.id;
    await f.advance(shop, id, 'delivered');
    return id;
  }

  const earnJobs = (orderId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT id FROM job WHERE type = 'loyalty_earn' AND idempotencyKey = ?`,
      [`loyalty:earn:${orderId}`],
    );
  async function drain(orderId: number) {
    for (const j of await earnJobs(orderId)) {
      await worker.processJobById(j.id as number);
    }
  }
  const entries = (customerId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT entryType, points, shortfall, orderId, returnId, storeCreditEntryId FROM loyaltyentry WHERE customerId = ? ORDER BY id`,
      [customerId],
    );
  async function balance(customerId: number) {
    const r = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(points),0) AS b FROM loyaltyentry WHERE customerId = ?`,
      [customerId],
    );
    return Number(r[0].b);
  }
  const account = (shop: Shop, sess: CustomerSession) =>
    asCustomer(server(), sess, 'get', `/public/${shop.slug}/account/loyalty`);
  async function expectedEarn(orderId: number) {
    const o = await f.orderRow(orderId);
    return Math.floor(
      Number(o.total) - Number(o.taxAmount ?? 0) - Number(o.deliveryFee ?? 0),
    );
  }

  describe('flag off', () => {
    it('writes nothing, shows nothing, and the admin routes are 404', async () => {
      const { shop, product, customer } = await setup('loy-off', {
        flag: false,
      });
      // a program row that exists and is enabled (as if the grant was withdrawn
      // later) must still do nothing while the platform flag is off
      await db.execute(
        `INSERT INTO loyaltyprogram (shopId, enabled, earnRate) VALUES (?, 1, 1)`,
        [shop.shopId],
      );
      await admin(shop, 'put', '/loyalty/program', {
        enabled: true,
        earnRate: '1',
      }).expect(404);
      expect(
        body<{ available: boolean }>(
          await admin(shop, 'get', '/loyalty/program').expect(200),
        ).available,
      ).toBe(false);
      const orderId = await delivered(shop, customer, product.id);
      expect(await earnJobs(orderId)).toHaveLength(0);
      await loyalty.earnForOrder({ shopId: shop.shopId, orderId });
      expect(await entries(customer.customerId)).toHaveLength(0);
      expect(
        body<{ enabled: boolean }>(await account(shop, customer).expect(200)),
      ).toEqual({ enabled: false });
      expect(
        body<{ available: boolean }>(
          await admin(
            shop,
            'get',
            `/customers/${customer.customerId}/loyalty`,
          ).expect(200),
        ).available,
      ).toBe(false);
      await admin(
        shop,
        'post',
        `/customers/${customer.customerId}/loyalty/adjustments`,
        { points: 10, reason: 'goodwill' },
      ).expect(404);
    });

    it('flag on but program never saved / disabled also earns nothing', async () => {
      const { shop, product, customer } = await setup('loy-noprog', {
        program: null,
      });
      const orderId = await delivered(shop, customer, product.id);
      expect(await earnJobs(orderId)).toHaveLength(0);
      expect(
        body<{ enabled: boolean }>(await account(shop, customer).expect(200))
          .enabled,
      ).toBe(false);
      // a shop cannot be switched on without a rate
      await admin(shop, 'put', '/loyalty/program', { enabled: true }).expect(
        400,
      );
    });
  });

  describe('earn', () => {
    it('earns once per delivered order, however often the job or handler runs', async () => {
      const { shop, product, customer } = await setup('loy-earn', {
        price: 87.5,
      });
      const orderId = await delivered(shop, customer, product.id, 3);
      const jobs = await earnJobs(orderId);
      expect(jobs).toHaveLength(1);
      // nothing earned before the job runs
      expect(await entries(customer.customerId)).toHaveLength(0);
      await Promise.all([
        loyalty.earnForOrder({ shopId: shop.shopId, orderId }),
        loyalty.earnForOrder({ shopId: shop.shopId, orderId }),
        loyalty.earnForOrder({ shopId: shop.shopId, orderId }),
        worker.processJobById(jobs[0].id as number),
      ]);
      await drain(orderId);
      await loyalty.earnForOrder({ shopId: shop.shopId, orderId });
      const rows = await entries(customer.customerId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entryType: 'earn', orderId });
      const want = await expectedEarn(orderId);
      expect(want).toBeGreaterThan(0);
      expect(rows[0].points).toBe(want);
      // the same events enqueue exactly one job
      await expect(
        loyalty.earnForOrder({ shopId: shop.shopId + 9999, orderId }),
      ).resolves.toBeUndefined(); // another tenant's id pair earns nothing
      expect(await entries(customer.customerId)).toHaveLength(1);
      // storefront account shows it
      const acc = body<{
        enabled: boolean;
        balance: number;
        entries: { type: string; points: number; reason: unknown }[];
        redeem: unknown;
      }>(await account(shop, customer).expect(200));
      expect(acc).toMatchObject({ enabled: true, balance: want, redeem: null });
      expect(acc.entries[0]).toMatchObject({ type: 'earn', points: want });
    });

    it('an order that is not delivered (cancelled) earns nothing even if the handler is called', async () => {
      const { shop, product, customer } = await setup('loy-cancel');
      const res = await checkout(shop, customer, product.id).expect(201);
      const id = body<{ order: { id: number } }>(res).order.id;
      await f.cancelOrder(shop, id).expect(201);
      await loyalty.earnForOrder({ shopId: shop.shopId, orderId: id });
      expect(await entries(customer.customerId)).toHaveLength(0);
    });

    it('a guest order earns nothing; neither does an anonymised account', async () => {
      const { shop, product, customer } = await setup('loy-guest');
      const guestOrder = await delivered(shop, null, product.id);
      await drain(guestOrder);
      await loyalty.earnForOrder({ shopId: shop.shopId, orderId: guestOrder });
      const all = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM loyaltyentry WHERE shopId = ?`,
        [shop.shopId],
      );
      expect(Number(all[0].n)).toBe(0);

      const orderId = await delivered(shop, customer, product.id);
      await db.execute(
        `UPDATE customer SET passwordHash = NULL, email = ? WHERE id = ?`,
        [
          `deleted-${customer.customerId}@deleted.requital`,
          customer.customerId,
        ],
      );
      await drain(orderId);
      expect(await entries(customer.customerId)).toHaveLength(0);
    });

    it('the base excludes tax, delivery and gift-card / store-credit tender, and rounds down', async () => {
      const { shop, product, customer } = await setup('loy-base', {
        price: 100,
      });
      await admin(
        shop,
        'post',
        `/customers/${customer.customerId}/store-credit/adjustments`,
        { currency: 'AED', amount: 40, direction: 'grant', reason: 'goodwill' },
      ).expect(201);
      const res = await checkout(shop, customer, product.id, 1, {
        useStoreCredit: true,
      }).expect(201);
      const orderId = body<{ order: { id: number } }>(res).order.id;
      await f.advance(shop, orderId, 'delivered');
      await drain(orderId);
      const o = await f.orderRow(orderId);
      expect(Number(o.storeCreditAmount)).toBe(40);
      const want = Math.floor(
        Number(o.total) -
          Number(o.taxAmount ?? 0) -
          Number(o.deliveryFee ?? 0) -
          40,
      );
      expect((await entries(customer.customerId))[0].points).toBe(want);
      // switching the base counts the tender money
      await admin(shop, 'put', '/loyalty/program', {
        earnBase: 'items_after_discount',
      }).expect(200);
      const second = await delivered(shop, customer, product.id);
      await drain(second);
      expect((await entries(customer.customerId))[1].points).toBe(
        await expectedEarn(second),
      );
    });
  });

  describe('clawback on return', () => {
    async function withEarned() {
      const s = await setup(`loy-claw${++seq}`);
      const orderId = await delivered(s.shop, s.customer, s.product.id, 2);
      await drain(orderId);
      const items = await f.orderItems(orderId);
      return { ...s, orderId, line: items[0].id as number };
    }
    const ret = (shop: Shop, orderId: number, items: object[]) =>
      request(server())
        .post(`/orders/${orderId}/returns`)
        .set(f.auth(shop))
        .send({ reason: 'changed_mind', items, restock: false });

    it('claws back proportionally, partial returns summing exactly to what was earned', async () => {
      const { shop, customer, orderId, line } = await withEarned();
      const earned = (await entries(customer.customerId))[0].points as number;
      expect(earned).toBeGreaterThan(1);
      await ret(shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(
        201,
      );
      const afterOne = await entries(customer.customerId);
      expect(afterOne).toHaveLength(2);
      expect(afterOne[1].entryType).toBe('clawback');
      expect(afterOne[1].points).toBeLessThan(0);
      expect(-(afterOne[1].points as number)).toBe(Math.floor(earned / 2));
      await ret(shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(
        201,
      );
      expect(await balance(customer.customerId)).toBe(0);
      const rows = await entries(customer.customerId);
      expect(rows.filter((r) => r.entryType === 'clawback')).toHaveLength(2);
      // exact: the two clawbacks sum to what was earned, no shortfall (a second
      // return must not re-take what the first already took)
      const claws = rows.filter((r) => r.entryType === 'clawback');
      expect(claws.reduce((a, r) => a + (r.points as number), 0)).toBe(-earned);
      expect(claws.every((r) => r.shortfall === 0)).toBe(true);
      // each return has exactly one clawback (unique returnId, entryType)
      const dup = await db.query<RowDataPacket[]>(
        `SELECT returnId, COUNT(*) AS n FROM loyaltyentry WHERE entryType = 'clawback' AND customerId = ? GROUP BY returnId HAVING n > 1`,
        [customer.customerId],
      );
      expect(dup).toHaveLength(0);
    });

    it('clamps at zero when the points are already spent and records the shortfall', async () => {
      const { shop, customer, orderId, line } = await withEarned();
      const earned = (await entries(customer.customerId))[0].points as number;
      await admin(
        shop,
        'post',
        `/customers/${customer.customerId}/loyalty/adjustments`,
        { points: -earned, reason: 'spent elsewhere' },
      ).expect(201);
      await ret(shop, orderId, [{ orderItemId: line, quantity: 2 }]).expect(
        201,
      );
      const claw = (await entries(customer.customerId)).find(
        (r) => r.entryType === 'clawback',
      )!;
      expect(claw.points).toBe(0);
      expect(claw.shortfall).toBe(earned);
      // visible to the merchant (admin only), hidden from the customer
      const adminView = body<{ shortfallTotal: number }>(
        await admin(
          shop,
          'get',
          `/customers/${customer.customerId}/loyalty`,
        ).expect(200),
      );
      expect(adminView.shortfallTotal).toBe(earned);
      const custView = body<{ entries: { shortfall: number }[] }>(
        await account(shop, customer).expect(200),
      );
      expect(custView.entries.every((e) => e.shortfall === 0)).toBe(true);
      expect(await balance(customer.customerId)).toBe(0);
    });

    it('flag off after earning: a return writes nothing', async () => {
      const { shop, customer, orderId, line } = await withEarned();
      await override(shop.shopId, 'loyalty', 0).catch(() =>
        db.execute(
          `UPDATE shopfeatureoverride SET enabled = 0 WHERE shopId = ? AND featureKey = 'loyalty'`,
          [shop.shopId],
        ),
      );
      await db.execute(
        `UPDATE shopfeatureoverride SET enabled = 0 WHERE shopId = ? AND featureKey = 'loyalty'`,
        [shop.shopId],
      );
      await ret(shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(
        201,
      );
      expect(await entries(customer.customerId)).toHaveLength(1);
    });
  });

  describe('review fixes', () => {
    const ret = (shop: Shop, orderId: number, items: object[]) =>
      request(server())
        .post(`/orders/${orderId}/returns`)
        .set(f.auth(shop))
        .send({ reason: 'changed_mind', items, restock: true });

    it('MED-1: the return takes the customer lock (clawback) BEFORE any stock work', async () => {
      const s = await setup(`loy-lock${++seq}`);
      const orderId = await delivered(s.shop, s.customer, s.product.id, 2);
      await drain(orderId);
      const line = (await f.orderItems(orderId))[0].id as number;
      const calls: string[] = [];
      type Fn = (...a: unknown[]) => Promise<unknown>;
      const record = (obj: object, name: string, tag: string) => {
        const target = obj as Record<string, Fn>;
        const orig: Fn = target[name].bind(obj) as Fn;
        jest
          .spyOn(target, name)
          .mockImplementation((...a: unknown[]): Promise<unknown> => {
            calls.push(tag);
            return orig(...a);
          });
      };
      const products = app.get(ProductsService);
      record(loyalty, 'clawbackForReturn', 'clawback');
      record(products, 'releaseOrderConsumption', 'stock');
      record(products, 'consumeForOrderItems', 'stock');
      try {
        await ret(s.shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(
          201,
        );
      } finally {
        jest.restoreAllMocks();
      }
      expect(calls.indexOf('clawback')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('stock')).toBeGreaterThan(calls.indexOf('clawback'));
    });

    it('MED-2: a return that landed before the earn job ran is netted off when the earn runs', async () => {
      const s = await setup(`loy-early${++seq}`);
      const orderId = await delivered(s.shop, s.customer, s.product.id, 2);
      const line = (await f.orderItems(orderId))[0].id as number;
      // the return happens first: no earn row exists yet
      await ret(s.shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(
        201,
      );
      expect(await entries(s.customer.customerId)).toHaveLength(0);
      await drain(orderId);
      const rows = await entries(s.customer.customerId);
      expect(rows.map((r) => r.entryType as string)).toEqual([
        'earn',
        'clawback',
      ]);
      const earned = rows[0].points as number;
      expect(rows[1].points as number).toBe(-Math.floor(earned / 2));
      expect(rows[1].shortfall).toBe(0);
      // the next return continues from there: the two clawbacks sum to the earn
      await ret(s.shop, orderId, [{ orderItemId: line, quantity: 1 }]).expect(
        201,
      );
      expect(await balance(s.customer.customerId)).toBe(0);
    });

    it('LOW: an online-payment order earns only once it is paid; cash at handover earns on delivered', async () => {
      const s = await setup(`loy-paid${++seq}`);
      const orderId = await delivered(s.shop, s.customer, s.product.id);
      await db.execute(
        `UPDATE \`order\` SET paymentMethod = 'card_online', paymentStatus = 'unpaid' WHERE id = ?`,
        [orderId],
      );
      await loyalty.earnForOrder({ shopId: s.shop.shopId, orderId });
      expect(await entries(s.customer.customerId)).toHaveLength(0);
      await db.execute(
        `UPDATE \`order\` SET paymentStatus = 'paid' WHERE id = ?`,
        [orderId],
      );
      await loyalty.earnForOrder({ shopId: s.shop.shopId, orderId });
      expect(await entries(s.customer.customerId)).toHaveLength(1);
    });

    it('LOW: rates are capped on save (400), and an extreme order cannot exceed the INT range', async () => {
      const s = await setup(`loy-cap${++seq}`);
      for (const bad of ['1000.0001', '5000', '99999999']) {
        await admin(s.shop, 'put', '/loyalty/program', {
          earnRate: bad,
        }).expect(400);
      }
      await admin(s.shop, 'put', '/loyalty/program', {
        earnRate: '1000',
      }).expect(200);
      await admin(s.shop, 'put', '/loyalty/program', {
        redeemPointsPerUnit: '1000001',
      }).expect(400);
      const orderId = await delivered(s.shop, s.customer, s.product.id);
      await db.execute(
        `UPDATE \`order\` SET total = 90000000000 WHERE id = ?`,
        [orderId],
      );
      await loyalty.earnForOrder({ shopId: s.shop.shopId, orderId });
      const pts = (await entries(s.customer.customerId))[0].points as number;
      expect(pts).toBe(1_000_000_000);
    });
  });

  describe('admin adjust and isolation', () => {
    it('adjusts with a reason, never below zero, idempotently, and audits it', async () => {
      const { shop, customer } = await setup('loy-adj');
      const url = `/customers/${customer.customerId}/loyalty/adjustments`;
      await admin(shop, 'post', url, { points: 50, reason: '' }).expect(400);
      await admin(shop, 'post', url, { points: 0, reason: 'nothing' }).expect(
        400,
      );
      await admin(shop, 'post', url, { points: 1.5, reason: 'half' }).expect(
        400,
      );
      await admin(shop, 'post', url, {
        points: 50,
        reason: 'goodwill',
        idempotencyKey: 'adj-key-0001',
      }).expect(201);
      const replay = body<{ replay: boolean; balance: number }>(
        await admin(shop, 'post', url, {
          points: 50,
          reason: 'goodwill',
          idempotencyKey: 'adj-key-0001',
        }).expect(201),
      );
      expect(replay).toMatchObject({ replay: true, balance: 50 });
      await admin(shop, 'post', url, {
        points: 60,
        reason: 'goodwill',
        idempotencyKey: 'adj-key-0001',
      }).expect(409);
      await admin(shop, 'post', url, { points: -51, reason: 'oops' }).expect(
        409,
      );
      // concurrent deductions cannot both pass
      const res = await Promise.all(
        [30, 30, 30].map((p) =>
          admin(shop, 'post', url, { points: -p, reason: 'race' }),
        ),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await balance(customer.customerId)).toBe(20);
      const audit = await db.query<RowDataPacket[]>(
        `SELECT action FROM auditlog WHERE shopId = ? AND action = 'customer.loyalty.adjusted'`,
        [shop.shopId],
      );
      expect(audit).toHaveLength(2);
    });

    it('cross-shop: an id from another shop is 404 on read and write; a customer sees only their own balance', async () => {
      const a = await setup('loy-iso-a');
      const b = await setup('loy-iso-b');
      await admin(
        a.shop,
        'post',
        `/customers/${a.customer.customerId}/loyalty/adjustments`,
        { points: 70, reason: 'goodwill' },
      ).expect(201);
      // an earn job pointed at another shop's delivered order writes nothing
      const aOrder = await delivered(a.shop, a.customer, a.product.id);
      await loyalty
        .earnForOrder({ shopId: b.shop.shopId, orderId: aOrder })
        .catch(() => undefined);
      expect(await balance(a.customer.customerId)).toBe(70);
      await drain(aOrder);
      const afterEarn = await balance(a.customer.customerId);
      expect(afterEarn).toBeGreaterThan(70);
      await admin(
        a.shop,
        'post',
        `/customers/${a.customer.customerId}/loyalty/adjustments`,
        { points: 70 - afterEarn, reason: 'reset' },
      ).expect(201);
      await admin(
        b.shop,
        'get',
        `/customers/${a.customer.customerId}/loyalty`,
      ).expect(404);
      await admin(
        b.shop,
        'post',
        `/customers/${a.customer.customerId}/loyalty/adjustments`,
        { points: 5, reason: 'cross shop' },
      ).expect(404);
      expect(await balance(a.customer.customerId)).toBe(70);
      expect(
        body<{ balance: number }>(await account(b.shop, b.customer).expect(200))
          .balance,
      ).toBe(0);
      expect(
        body<{ balance: number }>(await account(a.shop, a.customer).expect(200))
          .balance,
      ).toBe(70);
      // customer A's cookie on shop B's slug is not a session there
      await asCustomer(
        server(),
        a.customer,
        'get',
        `/public/${b.shop.slug}/account/loyalty`,
      ).expect(401);
      // customer view hides the staff reason
      const view = body<{ entries: { reason: unknown; actorName: unknown }[] }>(
        await account(a.shop, a.customer).expect(200),
      );
      expect(view.entries[0]).toMatchObject({ reason: null, actorName: null });
    });
  });

  describe('redeem (built, off until every gate is on)', () => {
    const redeem = (
      shop: Shop,
      sess: CustomerSession,
      points: number,
      key = `k${f.uniq()}`.slice(0, 36),
    ) =>
      asCustomer(
        server(),
        sess,
        'post',
        `/public/${shop.slug}/account/loyalty/redeem`,
      ).send({ points, idempotencyKey: key });
    async function ready(prefix: string, redeemCfg: object = {}) {
      const s = await setup(prefix, {
        program: {
          redeemEnabled: true,
          redeemPointsPerUnit: '10',
          redeemMinPoints: 20,
          redeemStepPoints: 10,
          redeemMaxPoints: 500,
          ...redeemCfg,
        },
      });
      await db.execute(
        `UPDATE customer SET phoneVerifiedAt = NOW(3) WHERE id = ?`,
        [s.customer.customerId],
      );
      await admin(
        s.shop,
        'post',
        `/customers/${s.customer.customerId}/loyalty/adjustments`,
        { points: 100, reason: 'seed balance' },
      ).expect(201);
      return s;
    }
    const credit = async (customerId: number) => {
      const r = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(amount),0) AS s FROM storecreditentry WHERE customerId = ?`,
        [customerId],
      );
      return Number(r[0].s);
    };

    it('is 404 while the shop phone OTP flag is off, even with everything else on', async () => {
      const { shop, customer } = await ready('loy-rd-gate');
      await redeem(shop, customer, 50).expect(404);
      expect(await credit(customer.customerId)).toBe(0);
      expect(await balance(customer.customerId)).toBe(100);
      expect(
        body<{ redeem: unknown }>(await account(shop, customer).expect(200))
          .redeem,
      ).toBeNull();
    });

    it('is 404 with redeemEnabled off or the loyalty flag off, even with phone OTP on', async () => {
      const a = await ready('loy-rd-a', { redeemEnabled: false });
      await override(a.shop.shopId, 'phone_otp_register');
      await redeem(a.shop, a.customer, 50).expect(404);
      const b = await ready('loy-rd-b');
      await override(b.shop.shopId, 'phone_otp_register');
      await db.execute(
        `UPDATE shopfeatureoverride SET enabled = 0 WHERE shopId = ? AND featureKey = 'loyalty'`,
        [b.shop.shopId],
      );
      await redeem(b.shop, b.customer, 50).expect(404);
      expect(await credit(b.customer.customerId)).toBe(0);
    });

    it('converts points to store credit at the program rate, once per key, within the limits', async () => {
      const { shop, customer } = await ready('loy-rd-ok');
      await override(shop.shopId, 'phone_otp_register');
      const shown = body<{ redeem: { pointsPerUnit: string } }>(
        await account(shop, customer).expect(200),
      );
      expect(shown.redeem.pointsPerUnit).toBe('10');
      // limits: below min, off step, above balance
      await redeem(shop, customer, 10).expect(400);
      await redeem(shop, customer, 25).expect(400);
      await redeem(shop, customer, 110).expect(409);
      const key = 'redeem-key-0001';
      const ok = body<{ credit: string; balance: number; replay: boolean }>(
        await redeem(shop, customer, 50, key).expect(201),
      );
      expect(ok).toMatchObject({ credit: '5.00', balance: 50, replay: false });
      const again = body<{ replay: boolean; balance: number }>(
        await redeem(shop, customer, 50, key).expect(201),
      );
      expect(again).toMatchObject({ replay: true, balance: 50 });
      await redeem(shop, customer, 60, key).expect(409);
      expect(await credit(customer.customerId)).toBe(5);
      const rows = await entries(customer.customerId);
      const r = rows.find((x) => x.entryType === 'redeem')!;
      expect(r.points).toBe(-50);
      expect(r.storeCreditEntryId).not.toBeNull();
      // a body-supplied rate or currency is not a thing
      await asCustomer(
        server(),
        customer,
        'post',
        `/public/${shop.slug}/account/loyalty/redeem`,
      )
        .send({ points: 20, idempotencyKey: 'redeem-key-0002', rate: 1 })
        .expect(400);
    });

    it('MED-3: an account that never proved its phone cannot redeem (404) and is not offered it', async () => {
      const { shop, customer } = await ready('loy-rd-unv');
      await override(shop.shopId, 'phone_otp_register');
      await db.execute(
        `UPDATE customer SET phoneVerifiedAt = NULL WHERE id = ?`,
        [customer.customerId],
      );
      await redeem(shop, customer, 50).expect(404);
      expect(await credit(customer.customerId)).toBe(0);
      expect(
        body<{ redeem: unknown }>(await account(shop, customer).expect(200))
          .redeem,
      ).toBeNull();
    });

    it('LOW: the store-credit key of a redemption cannot be pre-claimed by an admin', async () => {
      const { shop, customer } = await ready('loy-rd-key2');
      await override(shop.shopId, 'phone_otp_register');
      // staff cannot even type a key containing a colon
      await admin(
        shop,
        'post',
        `/customers/${customer.customerId}/store-credit/adjustments`,
        {
          currency: 'AED',
          amount: 1,
          direction: 'grant',
          reason: 'probe',
          idempotencyKey: 'loyalty:1234567',
        },
      ).expect(400);
      // and the old hyphen form no longer collides with a redemption
      const probe = await db.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(id), 0) + 1 AS n FROM loyaltyentry`,
      );
      await admin(
        shop,
        'post',
        `/customers/${customer.customerId}/store-credit/adjustments`,
        {
          currency: 'AED',
          amount: 1,
          direction: 'grant',
          reason: 'probe',
          idempotencyKey: `loyalty-${String(probe[0].n)}`,
        },
      ).expect(201);
      await redeem(shop, customer, 50).expect(201);
      const k = await db.query<RowDataPacket[]>(
        `SELECT idempotencyKey FROM storecreditentry WHERE customerId = ? AND reason = 'Loyalty points redeemed'`,
        [customer.customerId],
      );
      expect(String(k[0].idempotencyKey)).toMatch(/^loyalty:\d+$/);
    });

    it('concurrent redemptions cannot overspend the balance', async () => {
      const { shop, customer } = await ready('loy-rd-race');
      await override(shop.shopId, 'phone_otp_register');
      const res = await Promise.all(
        [1, 2, 3, 4, 5].map((i) =>
          redeem(shop, customer, 60, `race-key-000${i}`),
        ),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await balance(customer.customerId)).toBe(40);
      expect(await credit(customer.customerId)).toBe(6);
    });

    it('the same idempotency key from two customers is two independent redemptions', async () => {
      const { shop, customer } = await ready('loy-rd-key');
      const other = await registerCustomer(
        server(),
        shop.slug,
        phone(),
        `loy-${f.uniq()}@x.test`,
      );
      await db.execute(
        `UPDATE customer SET phoneVerifiedAt = NOW(3) WHERE id = ?`,
        [other.customerId],
      );
      await override(shop.shopId, 'phone_otp_register');
      // give the other customer a balance so only the key rule can refuse
      await admin(
        shop,
        'post',
        `/customers/${other.customerId}/loyalty/adjustments`,
        {
          points: 100,
          reason: 'seed balance',
        },
      ).expect(201);
      await redeem(shop, customer, 50, 'shared-key-0001').expect(201);
      // the same key from a different customer is its own redemption (keys are
      // namespaced per customer): it neither replays nor collides with theirs
      await redeem(shop, other, 50, 'shared-key-0001').expect(201);
      expect(await credit(other.customerId)).toBe(5);
      expect(await credit(customer.customerId)).toBe(5);
    });
  });

  describe('merge, export, anonymise', () => {
    it("a merge moves the duplicate's entries; export carries the ledger; anonymise scrubs the staff reason", async () => {
      const { shop, product, customer } = await setup('loy-pdpl');
      await f.storefrontOrder(shop, [{ productId: product.id, quantity: 1 }], {
        customerPhone: '0509990001',
        customerName: 'Dup',
        customerEmail: `${f.uniq()}@g.test`,
      });
      const dup = await db.query<RowDataPacket[]>(
        `SELECT id FROM customer WHERE shopId = ? AND phone = '0509990001'`,
        [shop.shopId],
      );
      const dupId = dup[0].id as number;
      await admin(shop, 'post', `/customers/${dupId}/loyalty/adjustments`, {
        points: 40,
        reason: 'named Fatima',
      }).expect(201);
      await admin(
        shop,
        'post',
        `/customers/${customer.customerId}/loyalty/adjustments`,
        {
          points: 10,
          reason: 'goodwill',
        },
      ).expect(201);
      await admin(shop, 'post', `/customers/${customer.customerId}/merge`, {
        duplicateIds: [dupId],
        confirm: 'MERGE',
      }).expect(201);
      expect(await balance(customer.customerId)).toBe(50);

      const exp = body<{ loyalty: { balance: number; entries: unknown[] } }>(
        await asCustomer(
          server(),
          customer,
          'get',
          `/public/${shop.slug}/account/export`,
        ).expect(200),
      );
      expect(exp.loyalty.balance).toBe(50);
      expect(exp.loyalty.entries).toHaveLength(2);
      expect(JSON.stringify(exp.loyalty)).not.toContain('Fatima');

      const req1 = body<{ confirmationToken: string }>(
        await asCustomer(
          server(),
          customer,
          'delete',
          `/public/${shop.slug}/account/me`,
        ).expect(202),
      );
      await asCustomer(
        server(),
        customer,
        'delete',
        `/public/${shop.slug}/account/me/confirm?token=${req1.confirmationToken}`,
      ).expect(200);
      const reasons = await db.query<RowDataPacket[]>(
        `SELECT reason FROM loyaltyentry WHERE customerId = ?`,
        [customer.customerId],
      );
      expect(reasons.map((r) => r.reason as string)).toEqual([
        '[removed]',
        '[removed]',
      ]);
      expect(await balance(customer.customerId)).toBe(50); // the ledger is kept
    });
  });
});
