import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OrderRow {
  id: number;
  customerId: number | null;
  status: string;
}
interface CustomerListRow {
  id: number;
  name: string;
  phone: string;
  orderCount: number;
  lifetimeValue: number;
}
interface CustomerListBody {
  data: CustomerListRow[];
  total: number;
}
interface CustomerDetailBody {
  id: number;
  name: string;
  phone: string;
  orderCount: number;
  lifetimeValue: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  orders: { id: number; status: string; total: string }[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
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

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 50,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `ROSE-${slugPrefix}-${runId}`,
        categoryIds: [body<IdRow>(category).id],
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
      outletId,
      productId: body<IdRow>(product).id,
      slug: `${slugPrefix}-${runId}`,
    };
  }

  function orderPayload(
    outletId: number,
    productId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      customerName: 'Ali Hassan',
      customerPhone: '0501234567',
      customerAddress: 'Pickup',
      emirate: 'Dubai',
      outletId,
      orderType: 'pickup',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }

  describe('lookup-or-create links repeat orders to one customer, not duplicates', () => {
    it('the same phone number across two admin-entered orders resolves to the same customer', async () => {
      const shop = await setupShop('lookup');
      const order1 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletId, shop.productId))
        .expect(201);
      const order2 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(orderPayload(shop.outletId, shop.productId))
        .expect(201);

      const c1 = body<OrderRow>(order1).customerId;
      const c2 = body<OrderRow>(order2).customerId;
      expect(c1).not.toBeNull();
      expect(c1).toBe(c2);

      const list = await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const customers = body<CustomerListBody>(list).data.filter(
        (c) => c.phone === '0501234567',
      );
      expect(customers).toHaveLength(1);
      expect(customers[0].orderCount).toBe(2);
    });

    it('an admin-entered order and a storefront order with the same phone share the customer record (one shared service method)', async () => {
      const shop = await setupShop('shared-path');

      const adminOrder = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, {
            customerPhone: '0509998888',
          }),
        )
        .expect(201);

      const storefrontOrder = await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletId,
          orderType: 'pickup',
          paymentMethod: 'cash_on_pickup',
          customerName: 'Ali Hassan',
          customerPhone: '0509998888',
          customerAddress: 'Pickup',
          emirate: 'Dubai',
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);

      const adminCustomerId = body<OrderRow>(adminOrder).customerId;
      const storefrontCustomerId = body<{ order: OrderRow }>(storefrontOrder)
        .order.customerId;
      expect(adminCustomerId).not.toBeNull();
      expect(adminCustomerId).toBe(storefrontCustomerId);
    });

    it('updates the saved name when a later order uses the same phone with a different name', async () => {
      const shop = await setupShop('name-update');
      const order1 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, {
            customerPhone: '0507776666',
            customerName: 'Old Name',
          }),
        )
        .expect(201);
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, {
            customerPhone: '0507776666',
            customerName: 'New Name',
          }),
        )
        .expect(201);

      const customerId = body<OrderRow>(order1).customerId!;
      const detail = await request(app.getHttpServer())
        .get(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<CustomerDetailBody>(detail).name).toBe('New Name');
    });
  });

  describe('concurrent orders for a brand-new phone number never race into a duplicate/500', () => {
    it('N concurrent order-creation requests for the same new phone all succeed and resolve to exactly one customer', async () => {
      const shop = await setupShop('race');
      const phone = '0509990000';
      const CONCURRENCY = 8;

      // findOrCreateForOrder runs as its own statement ahead of OrdersService's
      // $transaction (see orders.service.ts) — firing these together races
      // real, separate DB connections against the find-then-create window,
      // not just concurrent promises on one connection.
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app.getHttpServer())
            .post('/orders')
            .set('Authorization', `Bearer ${shop.adminToken}`)
            .send(
              orderPayload(shop.outletId, shop.productId, {
                customerPhone: phone,
              }),
            ),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(201);
      }
      const customerIds = new Set(
        results.map((r) => body<OrderRow>(r).customerId),
      );
      expect(customerIds.size).toBe(1);

      const list = await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const matches = body<CustomerListBody>(list).data.filter(
        (c) => c.phone === phone,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0].orderCount).toBe(CONCURRENCY);
    });
  });

  describe('multi-tenant isolation: identical phone numbers at two shops never merge', () => {
    it("shop B's customer with the same phone as shop A's is a completely separate record, invisible via shop A's list", async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      const SHARED_PHONE = '0501112222';

      const orderA = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send(
          orderPayload(shopA.outletId, shopA.productId, {
            customerPhone: SHARED_PHONE,
          }),
        )
        .expect(201);
      const orderB = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send(
          orderPayload(shopB.outletId, shopB.productId, {
            customerPhone: SHARED_PHONE,
          }),
        )
        .expect(201);

      const customerAId = body<OrderRow>(orderA).customerId;
      const customerBId = body<OrderRow>(orderB).customerId;
      expect(customerAId).not.toBe(customerBId);

      // Shop A cannot see or reach shop B's customer record by id.
      await request(app.getHttpServer())
        .get(`/customers/${customerBId}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(404);

      // Shop A's list of that phone number contains exactly its own customer.
      const listA = await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      const matchesA = body<CustomerListBody>(listA).data.filter(
        (c) => c.phone === SHARED_PHONE,
      );
      expect(matchesA).toHaveLength(1);
      expect(matchesA[0].id).toBe(customerAId);
    });
  });

  describe('lifetime value / order count: cancelled orders are excluded', () => {
    it('a cancelled order among three does not count toward orderCount or lifetimeValue', async () => {
      const shop = await setupShop('ltv');
      const phone = '0503334444';

      const o1 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, { customerPhone: phone }),
        )
        .expect(201);
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, { customerPhone: phone }),
        )
        .expect(201);
      const o3 = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, { customerPhone: phone }),
        )
        .expect(201);

      const customerId = body<OrderRow>(o1).customerId!;
      // Cancel the third order (still pending — a fresh order is always
      // pending, and pending -> cancelled is a valid transition).
      await request(app.getHttpServer())
        .post(`/orders/${body<IdRow>(o3).id}/cancel`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const d = body<CustomerDetailBody>(detail);
      expect(d.orderCount).toBe(2); // 3 placed, 1 cancelled
      expect(d.lifetimeValue).toBe(100); // 2 * 50 AED, the cancelled order's 50 excluded
      expect(d.orders).toHaveLength(3); // full history still shows the cancelled one

      const list = await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const row = body<CustomerListBody>(list).data.find(
        (c) => c.id === customerId,
      )!;
      expect(row.orderCount).toBe(2);
      expect(row.lifetimeValue).toBe(100);
    });
  });

  describe('permission boundary: customers are admin-only', () => {
    it('a branch user gets 403 on list/detail/update; the admin can use all three', async () => {
      const shop = await setupShop('perm');
      const order = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send(
          orderPayload(shop.outletId, shop.productId, {
            customerPhone: '0500001111',
          }),
        )
        .expect(201);
      const customerId = body<OrderRow>(order).customerId!;

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `perm-branch-${runId}@test.com`,
          password: 'password123',
          outletId: shop.outletId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `perm-branch-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Hijacked' })
        .expect(403);

      // The admin can do all three.
      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ name: 'Ali Hassan Updated' })
        .expect(200);
    });
  });
});
