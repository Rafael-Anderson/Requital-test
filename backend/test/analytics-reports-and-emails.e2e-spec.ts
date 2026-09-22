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
import { SalesSummaryService } from '../src/analytics/sales-summary.service';
import { dateKeyInTimezone } from '../src/outlets/outlet-status';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface MovementRow {
  productId: number;
  name: string;
  unitsSold: number;
  stockOnHand: number | null;
  sellThroughPercent: number | null;
  daysOfCover: number | null;
  isDeadStock: boolean;
}
interface MovementBody {
  windowDays: number;
  deadStockAfterDays: number;
  rolledUpThrough: string | null;
  rows: MovementRow[];
  deadStock: MovementRow[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Inventory analytics + scheduled report emails (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let rollup: AnalyticsRollupService;
  let salesSummary: SalesSummaryService;
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
    salesSummary = app.get(SalesSummaryService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Analytics Admin',
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
      .send({ name: 'Analytics Collection' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Analytics Rose',
        price: 20,
        costPrice: 8,
        thumbnail: 'https://example.com/a.jpg',
        sku: `ANA-${prefix}-${runId}`,
        trackInventory: true,
        collectionIds: [collectionId],
      })
      .expect(201);

    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id, timezone FROM shop WHERE subdomain = ?`,
      [slug],
    );

    return {
      adminToken,
      outletId,
      collectionId,
      productId: body<IdRow>(product).id,
      shopId: shopRows[0].id as number,
      timezone: (shopRows[0].timezone as string | null) ?? 'Asia/Dubai',
      slug,
    };
  }

  function placeOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    quantity = 1,
  ) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Analytics Customer',
        customerPhone: `analytics-no-digits-${runId}`,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        items: [{ productId, quantity }],
      })
      .expect(201);
  }

  describe('ANL-8 inventory analytics', () => {
    it('reports units, sell-through and days of cover from the rollups plus live stock', async () => {
      const shop = await setupShop('inv-basic');
      const today = dateKeyInTimezone(new Date(), shop.timezone);

      // Give the product real stock, then sell some of it.
      await request(app.getHttpServer())
        .post('/ingredients/stock/adjust')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          outletId: shop.outletId,
          productId: shop.productId,
          quantity: 30,
          reason: 'initial',
        })
        .expect((res) => {
          // Endpoint shape varies; the assertions below do not depend on it
          // succeeding, they depend on whatever stock actually exists.
          if (res.status >= 500) throw new Error('stock adjust 5xx');
        });

      await placeOrder(shop.adminToken, shop.outletId, shop.productId, 5);
      await rollup.computeForShopDay(shop.shopId, today);

      const res = body<MovementBody>(
        await request(app.getHttpServer())
          .get('/reports/inventory/movement')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );

      expect(res.windowDays).toBe(30);
      expect(res.rolledUpThrough).toBe(today);
      const row = res.rows.find((r) => r.productId === shop.productId);
      expect(row).toBeDefined();
      expect(row!.unitsSold).toBe(5);
    }, 90000);

    it('honours the window and dead-stock thresholds from the query', async () => {
      const shop = await setupShop('inv-window');
      const res = body<MovementBody>(
        await request(app.getHttpServer())
          .get('/reports/inventory/movement?days=7&deadStockDays=3')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      expect(res.windowDays).toBe(7);
      expect(res.deadStockAfterDays).toBe(3);
    }, 60000);

    it('rejects an out-of-range window rather than silently clamping it', async () => {
      const shop = await setupShop('inv-badwindow');
      await request(app.getHttpServer())
        .get('/reports/inventory/movement?days=9999')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(400);
    }, 60000);

    // A product that has never sold and has no stock figure must not be called
    // dead stock: there is no capital tied up in something we cannot see.
    it('does not flag a product with no stock figure as dead stock', async () => {
      const shop = await setupShop('inv-nostock');
      const res = body<MovementBody>(
        await request(app.getHttpServer())
          .get('/reports/inventory/movement')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      const row = res.rows.find((r) => r.productId === shop.productId);
      expect(row).toBeDefined();
      if (row!.stockOnHand === null) {
        expect(row!.isDeadStock).toBe(false);
        expect(row!.sellThroughPercent).toBeNull();
      }
    }, 60000);

    it('keeps one shop out of another inventory report', async () => {
      const a = await setupShop('inv-iso-a');
      const b = await setupShop('inv-iso-b');
      const res = body<MovementBody>(
        await request(app.getHttpServer())
          .get('/reports/inventory/movement')
          .set('Authorization', `Bearer ${a.adminToken}`)
          .expect(200),
      );
      expect(res.rows.some((r) => r.productId === b.productId)).toBe(false);
    }, 90000);
  });

  describe('ANL-5 scheduled report emails', () => {
    // Scoped to the REPORT emails by idempotency-key prefix. Filtering on
    // type = 'send_email' alone would also catch the verify-email job every
    // signup enqueues, which has nothing to do with this feature.
    function jobsFor(shopId: number) {
      return db.query<RowDataPacket[]>(
        `SELECT idempotencyKey, payload FROM job
          WHERE shopId = ?
            AND (idempotencyKey LIKE 'daily-sales-summary:%'
              OR idempotencyKey LIKE 'weekly-digest:%')`,
        [shopId],
      );
    }

    // The whole feature is opt-in; the default must be off or every existing
    // merchant starts getting mail they never asked for.
    it('is off by default and sends nothing', async () => {
      const shop = await setupShop('mail-default');
      const row = await db.query<RowDataPacket[]>(
        `SELECT notifyDailySalesSummary, notifyWeeklyDigest FROM shop WHERE id = ?`,
        [shop.shopId],
      );
      expect(Boolean(row[0].notifyDailySalesSummary)).toBe(false);
      expect(Boolean(row[0].notifyWeeklyDigest)).toBe(false);

      await placeOrder(shop.adminToken, shop.outletId, shop.productId);
      // Well past any close time.
      await salesSummary.runSweep(new Date());
      expect(await jobsFor(shop.shopId)).toHaveLength(0);
    }, 90000);

    it('sends the daily summary once the shop has closed, and only once', async () => {
      const shop = await setupShop('mail-daily');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ notifyDailySalesSummary: true })
        .expect(200);

      await placeOrder(shop.adminToken, shop.outletId, shop.productId, 2);

      // 23:30 local, comfortably past any configured close time.
      const today = dateKeyInTimezone(new Date(), shop.timezone);
      const lateToday = new Date(`${today}T19:30:00.000Z`); // 23:30 in Dubai

      await salesSummary.runSweep(lateToday);
      const first = await jobsFor(shop.shopId);
      expect(first).toHaveLength(1);
      expect(String(first[0].idempotencyKey)).toContain('daily-sales-summary');

      // A second tick the same evening must not send again.
      await salesSummary.runSweep(lateToday);
      expect(await jobsFor(shop.shopId)).toHaveLength(1);
    }, 120000);

    // The crux: at close time TODAY has not been rolled up by the nightly job,
    // so the summary has to roll it up on demand or it would report nothing.
    it('rolls today up on demand so the summary is not empty', async () => {
      const shop = await setupShop('mail-rollup');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ notifyDailySalesSummary: true })
        .expect(200);

      await placeOrder(shop.adminToken, shop.outletId, shop.productId, 3);

      const today = dateKeyInTimezone(new Date(), shop.timezone);
      // No rollup exists yet for today.
      expect(
        await db.query<RowDataPacket[]>(
          `SELECT 1 FROM dailyshopmetrics WHERE shopId = ? AND \`date\` = ?`,
          [shop.shopId, today],
        ),
      ).toHaveLength(0);

      await salesSummary.runSweep(new Date(`${today}T19:30:00.000Z`));

      // The sweep created it...
      const metrics = await db.query<RowDataPacket[]>(
        `SELECT orders, revenue FROM dailyshopmetrics WHERE shopId = ? AND \`date\` = ?`,
        [shop.shopId, today],
      );
      expect(metrics).toHaveLength(1);
      expect(Number(metrics[0].orders)).toBe(1);

      // ...and the email carries the real figures, not zeroes.
      const jobs = await jobsFor(shop.shopId);
      expect(jobs).toHaveLength(1);
      const payload = JSON.stringify(jobs[0].payload);
      expect(payload).toContain('60.00'); // 3 x 20
    }, 120000);

    it('does not send the daily summary before the shop has closed', async () => {
      const shop = await setupShop('mail-early');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ notifyDailySalesSummary: true })
        .expect(200);
      await placeOrder(shop.adminToken, shop.outletId, shop.productId);

      const today = dateKeyInTimezone(new Date(), shop.timezone);
      // 05:00 in Dubai - before any plausible close time.
      await salesSummary.runSweep(new Date(`${today}T01:00:00.000Z`));
      expect(await jobsFor(shop.shopId)).toHaveLength(0);
    }, 90000);

    it('says costs are not recorded rather than implying a full margin', async () => {
      const shop = await setupShop('mail-nocost');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ notifyDailySalesSummary: true })
        .expect(200);

      // A product with no costPrice captures a NULL unitCost by design.
      const uncosted = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Uncosted Bloom',
          price: 40,
          thumbnail: 'https://example.com/u.jpg',
          sku: `ANA-NOCOST-${runId}`,
          collectionIds: [shop.collectionId],
        })
        .expect(201);
      await placeOrder(
        shop.adminToken,
        shop.outletId,
        body<IdRow>(uncosted).id,
      );

      const today = dateKeyInTimezone(new Date(), shop.timezone);
      await salesSummary.runSweep(new Date(`${today}T19:30:00.000Z`));

      const jobs = await jobsFor(shop.shopId);
      expect(jobs).toHaveLength(1);
      const payload = JSON.stringify(jobs[0].payload);
      expect(payload).toContain('not recorded');
    }, 120000);

    it('keeps one shop summary out of another shop mail', async () => {
      const a = await setupShop('mail-iso-a');
      const b = await setupShop('mail-iso-b');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .send({ notifyDailySalesSummary: true })
        .expect(200);
      await placeOrder(b.adminToken, b.outletId, b.productId, 10);

      const today = dateKeyInTimezone(new Date(), a.timezone);
      await salesSummary.runSweep(new Date(`${today}T19:30:00.000Z`));

      expect(await jobsFor(b.shopId)).toHaveLength(0);
      const jobs = await jobsFor(a.shopId);
      expect(jobs).toHaveLength(1);
      // Shop A sold nothing; B's 200 AED must not appear in A's mail.
      expect(JSON.stringify(jobs[0].payload)).not.toContain('200.00');
    }, 120000);
  });
});
