import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { AnalyticsRollupService } from '../src/analytics/analytics-rollup.service';
import { dateKeyInTimezone } from '../src/outlets/outlet-status';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Analytics rollups (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let rollup: AnalyticsRollupService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
    rollup = app.get(AnalyticsRollupService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Rollup Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Blooms' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rollup Rose',
        price: 20,
        costPrice: 8,
        thumbnail: 'https://example.com/r.jpg',
        sku: `ROLLUP-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id, timezone FROM shop WHERE subdomain = ?`,
      [slug],
    );

    return {
      adminToken,
      outletId,
      collectionId: body<IdRow>(collection).id,
      productId: body<IdRow>(product).id,
      shopId: shopRows[0].id as number,
      timezone: (shopRows[0].timezone as string | null) ?? 'Asia/Dubai',
    };
  }

  async function placeOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    quantity: number,
  ) {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Rollup Customer',
        customerPhone: `rollup-no-digits-${runId}`,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        items: [{ productId, quantity }],
      })
      .expect(201);
    return body<IdRow>(res).id;
  }

  function shopMetrics(shopId: number, date: string) {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM dailyshopmetrics WHERE shopId = ? AND \`date\` = ?`,
      [shopId, date],
    );
  }

  function productMetrics(shopId: number, date: string) {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM dailyproductmetrics WHERE shopId = ? AND \`date\` = ?`,
      [shopId, date],
    );
  }

  // THE test this whole job's design is answerable to: the nightly tick can
  // fire twice for the same day (a retry, an overlapping catch-up, a manual
  // re-run) and the numbers must not move.
  it('running the rollup twice for the same day does not double-count', async () => {
    const shop = await setupShop('rollup-idem');
    const today = dateKeyInTimezone(new Date(), shop.timezone);
    await placeOrder(shop.adminToken, shop.outletId, shop.productId, 2);

    await rollup.computeForShopDay(shop.shopId, today);
    const first = await shopMetrics(shop.shopId, today);
    const firstProducts = await productMetrics(shop.shopId, today);
    expect(first).toHaveLength(1);
    expect(Number(first[0].orders)).toBe(1);
    expect(Number(first[0].revenue)).toBe(40); // 2 x 20
    expect(Number(first[0].cogs)).toBe(16); // 2 x 8, captured at order time
    expect(firstProducts).toHaveLength(1);
    expect(Number(firstProducts[0].units)).toBe(2);

    // Second run, same day, no new orders.
    await rollup.computeForShopDay(shop.shopId, today);
    const second = await shopMetrics(shop.shopId, today);
    const secondProducts = await productMetrics(shop.shopId, today);

    expect(second).toHaveLength(1); // not two rows
    expect(Number(second[0].orders)).toBe(1); // not 2
    expect(Number(second[0].revenue)).toBe(40); // not 80
    expect(Number(second[0].cogs)).toBe(16); // not 32
    expect(secondProducts).toHaveLength(1);
    expect(Number(secondProducts[0].units)).toBe(2);
  }, 60000);

  it('a recompute reflects an order cancelled after the first run', async () => {
    const shop = await setupShop('rollup-recompute');
    const today = dateKeyInTimezone(new Date(), shop.timezone);
    const orderId = await placeOrder(
      shop.adminToken,
      shop.outletId,
      shop.productId,
      1,
    );

    await rollup.computeForShopDay(shop.shopId, today);
    expect(Number((await shopMetrics(shop.shopId, today))[0].revenue)).toBe(20);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(201);

    // Delete-then-insert, not upsert, is what makes this correct: the day now
    // has no countable orders, so the stale row must not survive.
    await rollup.computeForShopDay(shop.shopId, today);
    const after = await shopMetrics(shop.shopId, today);
    expect(after).toHaveLength(1); // the computed-but-empty sentinel row
    expect(Number(after[0].orders)).toBe(0);
    expect(Number(after[0].revenue)).toBe(0);
    expect(after[0].cogs).toBeNull();
    expect(await productMetrics(shop.shopId, today)).toHaveLength(0);
  }, 60000);

  it('excludes an uncosted line from cogs and counts it instead', async () => {
    const shop = await setupShop('rollup-uncosted');
    const today = dateKeyInTimezone(new Date(), shop.timezone);

    // A product with no costPrice: its captured unitCost is NULL by design
    // (product-cost.ts returns null, never zero).
    const uncosted = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'No Cost Set',
        price: 50,
        thumbnail: 'https://example.com/n.jpg',
        sku: `NOCOST-${runId}`,
        collectionIds: [shop.collectionId],
      })
      .expect(201);

    await placeOrder(shop.adminToken, shop.outletId, shop.productId, 1); // costed
    await placeOrder(
      shop.adminToken,
      shop.outletId,
      body<IdRow>(uncosted).id,
      1,
    ); // uncosted

    await rollup.computeForShopDay(shop.shopId, today);
    const rows = await shopMetrics(shop.shopId, today);
    expect(Number(rows[0].orders)).toBe(2);
    expect(Number(rows[0].revenue)).toBe(70); // both lines sold
    expect(Number(rows[0].cogs)).toBe(8); // only the costed one
    expect(Number(rows[0].linesWithoutCost)).toBe(1);
  }, 60000);

  it('writes a computed-but-empty row for a day with no orders, so catch-up terminates', async () => {
    const shop = await setupShop('rollup-emptyday');
    const today = dateKeyInTimezone(new Date(), shop.timezone);

    await rollup.computeForShopDay(shop.shopId, today);
    const rows = await shopMetrics(shop.shopId, today);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].orders)).toBe(0);
    expect(rows[0].cogs).toBeNull();
    expect(rows[0].computedAt).toBeTruthy();
  }, 60000);

  describe('catch-up', () => {
    it('enqueues one job per missing day, and enqueueing twice stays one job', async () => {
      const shop = await setupShop('rollup-catchup');
      await placeOrder(shop.adminToken, shop.outletId, shop.productId, 1);

      // Backdate the order so there is a real gap to catch up.
      await db.execute(
        `UPDATE \`order\` SET createdAt = DATE_SUB(NOW(), INTERVAL 3 DAY)
          WHERE shopId = ?`,
        [shop.shopId],
      );

      const firstPass = await rollup.enqueueDueDays(shop.shopId, shop.timezone);
      expect(firstPass.length).toBeGreaterThanOrEqual(3);

      const jobsAfterFirst = await db.query<RowDataPacket[]>(
        `SELECT idempotencyKey FROM job
          WHERE shopId = ? AND type = 'compute_daily_rollup'`,
        [shop.shopId],
      );
      expect(jobsAfterFirst).toHaveLength(firstPass.length);

      // Same sweep again: the job table's UNIQUE idempotencyKey means no
      // duplicate work is queued.
      await rollup.enqueueDueDays(shop.shopId, shop.timezone);
      const jobsAfterSecond = await db.query<RowDataPacket[]>(
        `SELECT idempotencyKey FROM job
          WHERE shopId = ? AND type = 'compute_daily_rollup'`,
        [shop.shopId],
      );
      expect(jobsAfterSecond).toHaveLength(firstPass.length);
    }, 60000);

    it('enqueues nothing for a shop that has never had an order', async () => {
      const shop = await setupShop('rollup-noorders');
      expect(await rollup.enqueueDueDays(shop.shopId, shop.timezone)).toEqual(
        [],
      );
    }, 60000);
  });

  it('customer metrics are a recomputed snapshot, not an incrementing counter', async () => {
    const shop = await setupShop('rollup-customers');
    await placeOrder(shop.adminToken, shop.outletId, shop.productId, 1);
    await placeOrder(shop.adminToken, shop.outletId, shop.productId, 1);

    await rollup.recomputeCustomerMetrics(shop.shopId);
    const first = await db.query<RowDataPacket[]>(
      `SELECT * FROM customermetrics WHERE shopId = ?`,
      [shop.shopId],
    );
    expect(first).toHaveLength(1); // both orders share one customer row
    expect(Number(first[0].orderCount)).toBe(2);
    const ltv = Number(first[0].ltv);

    await rollup.recomputeCustomerMetrics(shop.shopId);
    const second = await db.query<RowDataPacket[]>(
      `SELECT * FROM customermetrics WHERE shopId = ?`,
      [shop.shopId],
    );
    expect(second).toHaveLength(1);
    expect(Number(second[0].orderCount)).toBe(2); // not 4
    expect(Number(second[0].ltv)).toBe(ltv); // not doubled
    expect(second[0].firstOrder).toBeTruthy();
    expect(second[0].lastOrder).toBeTruthy();
  }, 60000);

  it('keeps one shop out of another shop rollups', async () => {
    const a = await setupShop('rollup-iso-a');
    const b = await setupShop('rollup-iso-b');
    const today = dateKeyInTimezone(new Date(), a.timezone);
    await placeOrder(a.adminToken, a.outletId, a.productId, 1);
    await placeOrder(b.adminToken, b.outletId, b.productId, 50);

    await rollup.computeForShopDay(a.shopId, today);
    const rows = await shopMetrics(a.shopId, today);
    expect(Number(rows[0].revenue)).toBe(20); // never 1000
  }, 60000);
});
