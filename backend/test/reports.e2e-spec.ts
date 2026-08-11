import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OrderRow {
  id: number;
  status: string;
}
interface GeneralSummary {
  totalOrders: number;
  grandTotal: number;
  totalPayments: number;
  totalDeliveryFee: number;
}
interface GeneralOrderRow {
  id: number;
  outletName: string;
  orderType: string | null;
  channel: string | null;
  paymentMethod: string | null;
  total: string;
}
interface GeneralOrdersBody {
  data: GeneralOrderRow[];
  total: number;
}
interface ProductSalesRow {
  productId: number;
  name: string;
  orderCount: number;
  totalQuantity: number;
  totalSalePrice: number;
  deliveryFee: number;
}
interface ProductSalesBody {
  data: ProductSalesRow[];
  total: number;
}
interface ExternalDeliveryRow {
  id: number;
  orderId: number;
  carrier: string;
  vehicleType: string | null;
  price: string;
  destination: string;
  status: string;
}
interface ExternalDeliveryListBody {
  data: ExternalDeliveryRow[];
  total: number;
}
interface OrderDetailRow {
  id: number;
  externaldelivery: ExternalDeliveryRow | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Reports (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Shop Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outletsRes = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletAId = body<IdRow[]>(outletsRes)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);
    const outletBRes = await request(app.getHttpServer())
      .post('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Second Branch' })
      .expect(201);
    const outletBId = body<IdRow>(outletBRes).id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 20,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `ROSE-${slugPrefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    // Publishing requires meeting the readiness bar (outlet + product must
    // already exist — see ShopService.getPublishReadiness). Storefront order
    // creation then 404s for an unpublished shop (see
    // PublicService.assertPublished) — this suite creates storefront orders.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return {
      adminToken,
      outletAId,
      outletBId,
      productId: body<IdRow>(productRes).id,
      slug: `${slugPrefix}-${runId}`,
    };
  }

  function orderPayload(
    outletId: number,
    productId: number,
    quantity: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      customerName: 'Report Test Customer',
      customerPhone: '0501230001',
      customerAddress: 'Pickup',
      emirate: 'Dubai',
      outletId,
      orderType: 'pickup',
      items: [{ productId, quantity }],
      ...overrides,
    };
  }

  describe('General Report: filters narrow results correctly, stat cards match manual sums', () => {
    it('summary and order list respect outlet, orderType, channel, dateRange, and status filters', async () => {
      const shop = await setupShop('general');

      const o1 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletAId, shop.productId, 2, {
            orderType: 'delivery',
            deliveryFee: 0,
            channel: 'Google Ads',
          }),
        )
        .expect(201);
      const o2 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletAId, shop.productId, 1, {
            orderType: 'pickup',
            deliveryFee: 0,
            channel: 'Manual',
          }),
        )
        .expect(201);
      const o3 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletBId, shop.productId, 3, {
            orderType: 'delivery',
            deliveryFee: 0,
            channel: 'Google Ads',
          }),
        )
        .expect(201);
      // Orders: o1=40 AED (2*20), o2=20 AED (1*20), o3=60 AED (3*20). Total 120.

      // No filters: all three.
      const all = await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(all)).toEqual({
        totalOrders: 3,
        grandTotal: 120,
        totalPayments: 120,
        totalDeliveryFee: 0,
      });

      // Outlet filter.
      const byOutletA = await request(app.getHttpServer())
        .get(`/reports/general/summary?outletId=${shop.outletAId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(byOutletA)).toEqual({
        totalOrders: 2,
        grandTotal: 60,
        totalPayments: 60,
        totalDeliveryFee: 0,
      });

      // Order type filter.
      const byType = await request(app.getHttpServer())
        .get('/reports/general/summary?orderType=pickup')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(byType).totalOrders).toBe(1);
      expect(body<GeneralSummary>(byType).grandTotal).toBe(20);

      // Channel filter.
      const byChannel = await request(app.getHttpServer())
        .get('/reports/general/summary?channel=Google Ads')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(byChannel).totalOrders).toBe(2);
      expect(body<GeneralSummary>(byChannel).grandTotal).toBe(100);

      // Date range: far future excludes everything, wide-open past includes everything.
      const future = await request(app.getHttpServer())
        .get('/reports/general/summary?dateFrom=2099-01-01')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(future).totalOrders).toBe(0);
      const past = await request(app.getHttpServer())
        .get('/reports/general/summary?dateFrom=2020-01-01')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(past).totalOrders).toBe(3);

      // Status filter: cancel o2, then confirm status=cancelled isolates it
      // and General Report's default (unfiltered) view still counts it —
      // no implicit cancelled-exclusion here, unlike Product Sale Report.
      await request(app.getHttpServer())
        .post(`/orders/${body<IdRow>(o2).id}/cancel`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);
      const cancelledOnly = await request(app.getHttpServer())
        .get('/reports/general/summary?status=cancelled')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(cancelledOnly)).toEqual({
        totalOrders: 1,
        grandTotal: 20,
        totalPayments: 20,
        totalDeliveryFee: 0,
      });
      const unfilteredAfterCancel = await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(unfilteredAfterCancel).totalOrders).toBe(3);
      expect(body<GeneralSummary>(unfilteredAfterCancel).grandTotal).toBe(120);

      // Order list: search by order id, and confirm the row shape/fields.
      const list = await request(app.getHttpServer())
        .get(`/reports/general/orders?search=${body<IdRow>(o1).id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const listBody = body<GeneralOrdersBody>(list);
      expect(listBody.total).toBe(1);
      expect(listBody.data[0].id).toBe(body<IdRow>(o1).id);
      expect(listBody.data[0].outletName).toBeTruthy();

      void o3;
    });

    it('paymentMode filter matches storefront-set order.paymentMethod', async () => {
      const shop = await setupShop('payment-mode');
      await request(app.getHttpServer())
        .patch(`/outlets/${shop.outletAId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ pickupEnabled: true })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletAId,
          orderType: 'pickup',
          paymentMethod: 'cash_on_pickup',
          customerName: 'Storefront Customer',
          customerPhone: '0509990000',
          customerAddress: 'Pickup',
          emirate: 'Dubai',
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);

      const filtered = await request(app.getHttpServer())
        .get('/reports/general/summary?paymentMode=cash_on_pickup')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(filtered).totalOrders).toBe(1);

      const noMatch = await request(app.getHttpServer())
        .get('/reports/general/summary?paymentMode=card_online')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(noMatch).totalOrders).toBe(0);
    });
  });

  describe('Product Sale Report: aggregates correctly, excludes cancelled orders', () => {
    it('sums quantity/sale price across multiple orders and drops a cancelled one from the total', async () => {
      const shop = await setupShop('product-sales');

      const o1 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 2))
        .expect(201);
      const o2 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 1))
        .expect(201);
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletBId, shop.productId, 3))
        .expect(201);
      // 2 + 1 + 3 = 6 units across 3 orders before any cancellation.

      const beforeCancel = await request(app.getHttpServer())
        .get('/reports/product-sales')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rowBefore = body<ProductSalesBody>(beforeCancel).data.find(
        (r) => r.productId === shop.productId,
      )!;
      expect(rowBefore.orderCount).toBe(3);
      expect(rowBefore.totalQuantity).toBe(6);
      expect(rowBefore.totalSalePrice).toBe(120); // 6 * 20 AED
      expect(rowBefore.deliveryFee).toBe(0);
      void o1;

      // Cancel the 1-unit order — must drop out of the aggregate entirely.
      await request(app.getHttpServer())
        .post(`/orders/${body<IdRow>(o2).id}/cancel`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);

      const afterCancel = await request(app.getHttpServer())
        .get('/reports/product-sales')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rowAfter = body<ProductSalesBody>(afterCancel).data.find(
        (r) => r.productId === shop.productId,
      )!;
      expect(rowAfter.orderCount).toBe(2);
      expect(rowAfter.totalQuantity).toBe(5); // 2 + 3, the cancelled order's 1 excluded
      expect(rowAfter.totalSalePrice).toBe(100);
    });

    it('search matches by product name; sorting by totalSalePrice orders the higher earner first', async () => {
      const shop = await setupShop('product-sort');
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ name: 'Second Collection' })
        .expect(201);
      const secondProduct = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Cheap Filler',
          price: 5,
          thumbnail: 'https://example.com/filler.jpg',
          sku: `FILLER-${runId}`,
          collectionIds: [body<IdRow>(collection).id],
        })
        .expect(201);
      const secondProductId = body<IdRow>(secondProduct).id;

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 10)) // 200 AED
        .expect(201);
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, secondProductId, 1)) // 5 AED
        .expect(201);

      const sorted = await request(app.getHttpServer())
        .get('/reports/product-sales?sortBy=totalSalePrice&sortDir=desc')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rows = body<ProductSalesBody>(sorted).data;
      expect(rows[0].productId).toBe(shop.productId);

      const searched = await request(app.getHttpServer())
        .get('/reports/product-sales?search=Cheap')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const searchRows = body<ProductSalesBody>(searched).data;
      expect(searchRows).toHaveLength(1);
      expect(searchRows[0].productId).toBe(secondProductId);
    });
  });

  describe('multi-tenant isolation', () => {
    it("shop A's reports never include shop B's orders or products, even with identical data shapes", async () => {
      const shopA = await setupShop('iso-a');
      const shopB = await setupShop('iso-b');

      const orderA = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send(orderPayload(shopA.outletAId, shopA.productId, 1))
        .expect(201);
      const orderB = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send(orderPayload(shopB.outletAId, shopB.productId, 100)) // deliberately huge, would visibly skew shop A's totals if leaked
        .expect(201);

      const summaryA = await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(summaryA).totalOrders).toBe(1);
      expect(body<GeneralSummary>(summaryA).grandTotal).toBe(20); // 1 * 20, not inflated by shop B's 100-unit order

      const ordersA = await request(app.getHttpServer())
        .get('/reports/general/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      const idsA = body<GeneralOrdersBody>(ordersA).data.map((o) => o.id);
      expect(idsA).toContain(body<OrderRow>(orderA).id);
      expect(idsA).not.toContain(body<OrderRow>(orderB).id);

      const productsA = await request(app.getHttpServer())
        .get('/reports/product-sales')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      const productIdsA = body<ProductSalesBody>(productsA).data.map(
        (p) => p.productId,
      );
      expect(productIdsA).toContain(shopA.productId);
      expect(productIdsA).not.toContain(shopB.productId);
    });
  });

  describe('permission boundary: reports are admin-only', () => {
    it('a branch user gets 403 on every reports endpoint; the admin gets 200', async () => {
      const shop = await setupShop('perm');
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `reports-branch-${runId}@test.com`,
          password: 'password123',
          outletId: shop.outletAId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `reports-branch-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/reports/general/orders')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/reports/product-sales')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/reports/general/summary')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
    });
  });

  describe('Monthly Report: month resolves to the correct date range, reusing General Report logic', () => {
    it('excludes an order backdated outside the selected month and includes it when that month is selected instead', async () => {
      const shop = await setupShop('monthly');
      const oThisMonth = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 1))
        .expect(201);
      const oOtherMonth = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 1))
        .expect(201);

      const now = new Date();
      // Mid-month, 2 months back — far enough from "now" that this can
      // never accidentally land in the current month regardless of today's
      // date, without the day-of-month rollover issues subtracting months
      // naively from "now" can hit near a month boundary.
      const otherMonthDate = new Date(
        now.getFullYear(),
        now.getMonth() - 2,
        15,
      );
      await db.execute(`UPDATE \`order\` SET createdAt = ? WHERE id = ?`, [
        otherMonthDate,
        body<IdRow>(oOtherMonth).id,
      ]);

      const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const otherMonthKey = `${otherMonthDate.getFullYear()}-${String(otherMonthDate.getMonth() + 1).padStart(2, '0')}`;

      const summaryThisMonth = await request(app.getHttpServer())
        .get(`/reports/monthly/summary?month=${thisMonthKey}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(summaryThisMonth).totalOrders).toBe(1);

      const ordersThisMonth = await request(app.getHttpServer())
        .get(`/reports/monthly/orders?month=${thisMonthKey}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const idsThisMonth = body<GeneralOrdersBody>(ordersThisMonth).data.map(
        (o) => o.id,
      );
      expect(idsThisMonth).toContain(body<IdRow>(oThisMonth).id);
      expect(idsThisMonth).not.toContain(body<IdRow>(oOtherMonth).id);

      const summaryOtherMonth = await request(app.getHttpServer())
        .get(`/reports/monthly/summary?month=${otherMonthKey}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(summaryOtherMonth).totalOrders).toBe(1);

      const ordersOtherMonth = await request(app.getHttpServer())
        .get(`/reports/monthly/orders?month=${otherMonthKey}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const idsOtherMonth = body<GeneralOrdersBody>(ordersOtherMonth).data.map(
        (o) => o.id,
      );
      expect(idsOtherMonth).toContain(body<IdRow>(oOtherMonth).id);
      expect(idsOtherMonth).not.toContain(body<IdRow>(oThisMonth).id);
    });

    it('applies the same non-date filters as General Report (outlet)', async () => {
      const shop = await setupShop('monthly-filter');
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 1))
        .expect(201);
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletBId, shop.productId, 1))
        .expect(201);

      const now = new Date();
      const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const filtered = await request(app.getHttpServer())
        .get(
          `/reports/monthly/summary?month=${thisMonthKey}&outletId=${shop.outletAId}`,
        )
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<GeneralSummary>(filtered).totalOrders).toBe(1);
    });

    it('rejects a malformed month value', async () => {
      const shop = await setupShop('monthly-bad');
      await request(app.getHttpServer())
        .get('/reports/monthly/summary?month=not-a-month')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(400);
    });
  });

  describe('External Delivery: manual courier logging + report', () => {
    it('logs, updates, and reports an external delivery; a second log attempt on the same order is rejected', async () => {
      const shop = await setupShop('extdelivery');
      const order = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 1))
        .expect(201);
      const orderId = body<IdRow>(order).id;

      const created = await request(app.getHttpServer())
        .post(`/orders/${orderId}/external-delivery`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          carrier: 'Careem',
          vehicleType: 'Bike',
          price: 15,
          destination: 'Downtown Dubai',
        })
        .expect(201);
      expect(body<ExternalDeliveryRow>(created).status).toBe('pending');

      // One record per order — a second attempt is rejected, not silently
      // overwritten or duplicated.
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/external-delivery`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ carrier: 'Talabat', price: 20, destination: 'Downtown Dubai' })
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/external-delivery`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      // Surfaced on the order detail fetch (OrderDetailModal's data source).
      const detail = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<OrderDetailRow>(detail).externaldelivery?.status).toBe(
        'delivered',
      );
      expect(body<OrderDetailRow>(detail).externaldelivery?.carrier).toBe(
        'Careem',
      );

      const report = await request(app.getHttpServer())
        .get('/reports/external-delivery')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<ExternalDeliveryListBody>(report).data.find(
        (r) => r.orderId === orderId,
      )!;
      expect(row.carrier).toBe('Careem');
      expect(row.vehicleType).toBe('Bike');
      expect(Number(row.price)).toBe(15);
      expect(row.status).toBe('delivered');
    });

    it('is admin-only for both logging and the report; branch users get 403', async () => {
      const shop = await setupShop('extdelivery-perm');
      const order = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletAId, shop.productId, 1))
        .expect(201);
      const orderId = body<IdRow>(order).id;

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `extdelivery-branch-${runId}@test.com`,
          password: 'password123',
          outletId: shop.outletAId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `extdelivery-branch-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/external-delivery`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ carrier: 'Careem', price: 15, destination: 'Downtown Dubai' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/reports/external-delivery')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });

    it("a shop cannot log an external delivery on another shop's order, and never sees it in its own report", async () => {
      const shopA = await setupShop('extdelivery-iso-a');
      const shopB = await setupShop('extdelivery-iso-b');
      const orderB = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send(orderPayload(shopB.outletAId, shopB.productId, 1))
        .expect(201);
      const orderBId = body<IdRow>(orderB).id;

      // Shop A's admin guessing shop B's order id gets 404, not a
      // cross-tenant write.
      await request(app.getHttpServer())
        .post(`/orders/${orderBId}/external-delivery`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ carrier: 'Careem', price: 15, destination: 'Somewhere' })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/orders/${orderBId}/external-delivery`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ carrier: 'Careem', price: 15, destination: 'Somewhere' })
        .expect(201);

      const reportA = await request(app.getHttpServer())
        .get('/reports/external-delivery')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(
        body<ExternalDeliveryListBody>(reportA).data.map((r) => r.orderId),
      ).not.toContain(orderBId);
    });
  });
});
