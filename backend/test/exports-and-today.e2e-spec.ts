import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface TodayBody {
  date: string;
  timezone: string;
  orders: number;
  cancelledOrders: number;
  revenue: number;
  ordersByStatus: Record<string, number>;
  slots: { slot: string; orders: number }[];
  unslotted: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// The header row plus one line per record; the BOM is stripped first because
// it is a byte-order marker, not data.
function csvLines(text: string): string[] {
  return text
    .replace(/^\ufeff/, '')
    .split('\r\n')
    .filter((l) => l.length > 0);
}

describe('Server-side exports + today dashboard (e2e)', () => {
  let app: INestApplication<App>;
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Export Admin',
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
    const collectionId = body<IdRow>(collection).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Export Rose',
        price: 20,
        costPrice: 8,
        thumbnail: 'https://example.com/e.jpg',
        sku: `EXP-${prefix}-${runId}`,
        collectionIds: [collectionId],
      })
      .expect(201);

    return {
      adminToken,
      outletId,
      collectionId,
      productId: body<IdRow>(product).id,
      slug,
    };
  }

  function placeOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    extra: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Export Customer',
        customerPhone: `export-no-digits-${runId}`,
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        items: [{ productId, quantity: 1 }],
        ...extra,
      })
      .expect(201);
  }

  describe('server-side CSV exports', () => {
    // The bug this whole endpoint replaces: the in-page button serialised
    // whatever rows were already loaded, so "export all customers" on a
    // paginated list produced one page. The server export must return every
    // row regardless of any page size.
    it('exports every row, not just one page', async () => {
      const shop = await setupShop('exp-allrows');

      // The customers list pages at 20; create more than that.
      for (let i = 0; i < 25; i++) {
        await request(app.getHttpServer())
          .post('/orders')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({
            customerName: `Customer ${i}`,
            customerPhone: `exp-cust-${i}-${runId}`,
            customerAddress: 'Pickup',
            emirate: 'Dubai',
            outletId: shop.outletId,
            orderType: 'pickup',
            items: [{ productId: shop.productId, quantity: 1 }],
          })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get('/exports/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('customers-');

      const lines = csvLines(res.text);
      expect(lines[0]).toBe('Name,Phone,Orders,Lifetime Value,Last Order');
      expect(lines.length).toBe(26); // header + 25 customers, not 21
    }, 90000);

    it('starts with a UTF-8 BOM so Excel does not mangle non-ASCII names', async () => {
      const shop = await setupShop('exp-bom');
      const res = await request(app.getHttpServer())
        .get('/exports/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(res.text.startsWith('\ufeff')).toBe(true);
    }, 60000);

    it('scopes every export to the caller shop', async () => {
      const a = await setupShop('exp-iso-a');
      const b = await setupShop('exp-iso-b');
      await placeOrder(a.adminToken, a.outletId, a.productId);
      await placeOrder(b.adminToken, b.outletId, b.productId);

      const res = await request(app.getHttpServer())
        .get('/exports/orders')
        .set('Authorization', `Bearer ${a.adminToken}`)
        .expect(200);
      const lines = csvLines(res.text);
      // Shop A placed exactly one order; shop B's must not appear at all.
      expect(lines.length).toBe(2);
      expect(res.text).toContain('Export Customer');
    }, 90000);

    it('rejects an unknown export kind rather than guessing one', async () => {
      const shop = await setupShop('exp-unknown');
      await request(app.getHttpServer())
        .get('/exports/definitely-not-a-report')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(404);
    }, 60000);

    it('cannot be reached unauthenticated', async () => {
      await request(app.getHttpServer()).get('/exports/customers').expect(401);
    });

    it('escapes a comma in a value instead of splitting the column', async () => {
      const shop = await setupShop('exp-escape');
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          customerName: 'Doe, Jane',
          customerPhone: `exp-escape-${runId}`,
          customerAddress: 'Pickup',
          emirate: 'Dubai',
          outletId: shop.outletId,
          orderType: 'pickup',
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/exports/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(res.text).toContain('"Doe, Jane"');
    }, 60000);

    it('exports the margin report using the cost captured at order time', async () => {
      const shop = await setupShop('exp-margin');
      await placeOrder(shop.adminToken, shop.outletId, shop.productId);

      const res = await request(app.getHttpServer())
        .get('/exports/margin')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const lines = csvLines(res.text);
      expect(lines[0]).toBe(
        'Product,Revenue,Cost,Margin,Margin %,Uncosted Lines',
      );
      // 20 sold, 8 cost captured -> 12 margin at 60%.
      expect(lines[1]).toContain('20.00,8.00,12.00,60.0');
    }, 60000);

    it('serves every registered kind without erroring', async () => {
      const shop = await setupShop('exp-allkinds');
      await placeOrder(shop.adminToken, shop.outletId, shop.productId);
      for (const kind of [
        'customers',
        'orders',
        'inventory',
        'newsletter-subscribers',
        'margin',
      ]) {
        const res = await request(app.getHttpServer())
          .get(`/exports/${kind}`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200);
        // Header row always present, even when the shop has no such data.
        expect(csvLines(res.text).length).toBeGreaterThanOrEqual(1);
      }
    }, 90000);
  });

  describe('today dashboard (ANL-9)', () => {
    it('reports live orders and revenue for today', async () => {
      const shop = await setupShop('today-live');
      await placeOrder(shop.adminToken, shop.outletId, shop.productId);
      await placeOrder(shop.adminToken, shop.outletId, shop.productId);

      const res = await request(app.getHttpServer())
        .get('/dashboard/today')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const todayBody = body<TodayBody>(res);

      expect(todayBody.orders).toBe(2);
      expect(todayBody.revenue).toBe(40);
      expect(todayBody.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(todayBody.timezone).toBeTruthy();
      expect(todayBody.ordersByStatus.pending).toBe(2);
    }, 60000);

    // Live, not rolled up: an order placed seconds ago has to appear, which is
    // exactly what a rollup-backed card could not do.
    it('reflects an order placed moments ago, with no rollup run', async () => {
      const shop = await setupShop('today-immediate');
      const before = body<TodayBody>(
        await request(app.getHttpServer())
          .get('/dashboard/today')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      expect(before.orders).toBe(0);
      expect(before.revenue).toBe(0);

      await placeOrder(shop.adminToken, shop.outletId, shop.productId);

      const after = body<TodayBody>(
        await request(app.getHttpServer())
          .get('/dashboard/today')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      expect(after.orders).toBe(1);
      expect(after.revenue).toBe(20);
    }, 60000);

    it('counts a cancelled order as activity but keeps it out of revenue', async () => {
      const shop = await setupShop('today-cancelled');
      const order = await placeOrder(
        shop.adminToken,
        shop.outletId,
        shop.productId,
      );
      await request(app.getHttpServer())
        .post(`/orders/${body<IdRow>(order).id}/cancel`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);

      const todayBody = body<TodayBody>(
        await request(app.getHttpServer())
          .get('/dashboard/today')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      expect(todayBody.orders).toBe(0);
      expect(todayBody.revenue).toBe(0);
      expect(todayBody.cancelledOrders).toBe(1);
    }, 60000);

    it('groups delivery slots for today and counts unslotted orders', async () => {
      const shop = await setupShop('today-slots');
      const today = body<TodayBody>(
        await request(app.getHttpServer())
          .get('/dashboard/today')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      ).date;

      await placeOrder(shop.adminToken, shop.outletId, shop.productId, {
        deliveryDate: today,
      });

      const res = body<TodayBody>(
        await request(app.getHttpServer())
          .get('/dashboard/today')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .expect(200),
      );
      // No slot was chosen, so it must show as due-today-but-unslotted rather
      // than vanishing from the card entirely.
      expect(res.unslotted).toBe(1);
    }, 60000);

    it('keeps one shop out of another today figures', async () => {
      const a = await setupShop('today-iso-a');
      const b = await setupShop('today-iso-b');
      await placeOrder(b.adminToken, b.outletId, b.productId);

      const res = body<TodayBody>(
        await request(app.getHttpServer())
          .get('/dashboard/today')
          .set('Authorization', `Bearer ${a.adminToken}`)
          .expect(200),
      );
      expect(res.orders).toBe(0);
      expect(res.revenue).toBe(0);
    }, 90000);
  });
});
