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
interface OutletRow {
  id: number;
}
interface ProductRow {
  id: number;
}
interface OrderItemRow {
  id: number;
  productId: number;
  quantity: number;
  priceAtPurchase: string;
}
interface OrderRow {
  id: number;
  status: string;
  total: string;
  paymentStatus: string;
  outletId: number;
  orderitem: OrderItemRow[];
}
interface OrderReturnRow {
  id: number;
  refundAmount: string;
  refundMethod: string;
  restocked: boolean;
  orderreturnitem: { orderItemId: number; quantity: number }[];
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

describe('Order Returns/Refunds (e2e)', () => {
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
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Returns Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    return { adminToken, outletId, collectionId };
  }

  async function createProduct(
    adminToken: string,
    collectionId: number,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Return Item ${Math.random()}`,
        price: 20,
        thumbnail: 'https://example.com/x.jpg',
        sku: `RET-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
        trackInventory: true,
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  async function seedStock(
    adminToken: string,
    outletId: number,
    productId: number,
    qty: number,
  ) {
    await request(app.getHttpServer())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId, outletId, delta: qty, reason: 'received' })
      .expect(201);
  }

  async function stockAt(
    adminToken: string,
    outletId: number,
    productId: number,
  ): Promise<number> {
    const res = await request(app.getHttpServer())
      .get(`/products/${productId}?outletId=${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return body<{ stockQuantity: number | null }>(res).stockQuantity ?? 0;
  }

  async function createDeliveredOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    quantity: number,
  ): Promise<OrderRow> {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Return Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        orderType: 'delivery',
        outletId,
        items: [{ productId, quantity }],
      })
      .expect(201);
    const order = body<OrderRow>(res);
    for (const status of [
      'confirmed',
      'preparing',
      'out_for_delivery',
      'delivered',
    ]) {
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status })
        .expect(200);
    }
    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return body<OrderRow>(detail);
  }

  describe('refund calculation', () => {
    it('computes the default refund from priceAtPurchase * returned quantity, editable via override', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('return-calc');
      const product = await createProduct(adminToken, collectionId, {
        price: 25,
      });
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        4,
      );
      const itemId = order.orderitem[0].id;

      // Partial return of 2 units @ 25 => 50, computed automatically.
      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 2 }],
          reason: 'damaged',
          restock: false,
        })
        .expect(201);
      const created = body<OrderReturnRow>(res);
      expect(Number(created.refundAmount)).toBe(50);

      // Second return: 1 more unit, explicit override to 10 instead of the computed 25.
      const res2 = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 1 }],
          reason: 'other',
          restock: false,
          refundAmount: 10,
        })
        .expect(201);
      expect(Number(body<OrderReturnRow>(res2).refundAmount)).toBe(10);
    });

    it('rejects returning more units of a line item than remain unreturned', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('return-line-cap');
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        3,
      );
      const itemId = order.orderitem[0].id;

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 2 }],
          reason: 'damaged',
          restock: false,
        })
        .expect(201);

      // Only 1 remains (3 - 2) — asking for 2 more must fail.
      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 2 }],
          reason: 'damaged',
          restock: false,
        })
        .expect(400);
    });
  });

  describe('running-total cap', () => {
    it('never lets cumulative refunds across multiple returns exceed the order total', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('return-running-cap');
      const product = await createProduct(adminToken, collectionId, {
        price: 30,
      });
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        3,
      ); // total 90
      const itemId = order.orderitem[0].id;

      // Return 2 units (60) with an inflated override just under the total.
      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 2 }],
          reason: 'damaged',
          restock: false,
          refundAmount: 80,
        })
        .expect(201);

      // Any further refund (even a small one) now exceeds 90 total (80 already refunded).
      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 1 }],
          reason: 'damaged',
          restock: false,
          refundAmount: 20,
        })
        .expect(400);
      expect(messageContains(res, 'exceed the order total')).toBe(true);

      const finalOrder = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      // paymentStatus only flips to 'refunded' once cumulative >= total — 80 < 90, unchanged.
      expect(body<OrderRow>(finalOrder).paymentStatus).toBe('unpaid');
    });

    it('flips order.paymentStatus to refunded once cumulative refunds reach the total', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('return-full-refund');
      const product = await createProduct(adminToken, collectionId, {
        price: 40,
      });
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        2,
      ); // total 80
      const itemId = order.orderitem[0].id;

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 2 }],
          reason: 'changed_mind',
          restock: false,
        })
        .expect(201);

      const finalOrder = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<OrderRow>(finalOrder).paymentStatus).toBe('refunded');
    });
  });

  describe('restock', () => {
    it('restocking a return increments stock and logs a RETURN stockmovement row', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('return-restock');
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        3,
      );
      // Confirm decremented 3 already.
      expect(await stockAt(adminToken, outletId, product.id)).toBe(7);
      const itemId = order.orderitem[0].id;

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 2 }],
          reason: 'wrong_item',
          restock: true,
        })
        .expect(201);

      expect(await stockAt(adminToken, outletId, product.id)).toBe(9);
      const movement = await prisma.stockmovement.findFirst({
        where: { productId: product.id, type: 'RETURN' },
      });
      expect(movement).not.toBeNull();
      expect(movement?.delta).toBe(2);
      expect(movement?.outletId).toBe(outletId);
    });

    it('does not restock when restock is false', async () => {
      const { adminToken, collectionId, outletId } =
        await setupShop('return-no-restock');
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        2,
      );
      expect(await stockAt(adminToken, outletId, product.id)).toBe(8);
      const itemId = order.orderitem[0].id;

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 1 }],
          reason: 'damaged',
          restock: false,
        })
        .expect(201);

      expect(await stockAt(adminToken, outletId, product.id)).toBe(8);
    });
  });

  describe('provider refund fallback', () => {
    it('falls back to a manual refund and still records it when the provider call fails', async () => {
      const { adminToken, collectionId, outletId } = await setupShop(
        'return-provider-fail',
      );
      const product = await createProduct(adminToken, collectionId);
      await seedStock(adminToken, outletId, product.id, 10);
      const order = await createDeliveredOrder(
        adminToken,
        outletId,
        product.id,
        2,
      );
      const itemId = order.orderitem[0].id;

      // Simulate a Stripe-paid order: no real Stripe credentials are
      // configured in this test environment, so ReturnsService's attempt to
      // call stripe.refunds.create() is guaranteed to throw — this is
      // exactly the "provider call fails" path, not a mock standing in for it.
      await prisma.paymenttransaction.create({
        data: {
          orderId: order.id,
          gateway: 'stripe',
          gatewayReference: `evt_test_${runId}`,
          providerChargeReference: `pi_test_${runId}`,
          amount: order.total,
          status: 'paid',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: itemId, quantity: 1 }],
          reason: 'damaged',
          restock: false,
        })
        .expect(201);
      const created = body<OrderReturnRow>(res);
      expect(created.refundMethod).toBe('manual');
    });
  });

  describe('eligibility', () => {
    it('rejects a return for an order that is not delivered', async () => {
      const { adminToken, collectionId, outletId } = await setupShop(
        'return-not-delivered',
      );
      const product = await createProduct(adminToken, collectionId);
      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerName: 'Not Delivered',
          customerPhone: '0501234567',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          orderType: 'delivery',
          outletId,
          items: [{ productId: product.id, quantity: 1 }],
        })
        .expect(201);
      const order = body<OrderRow>(orderRes);

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/returns`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ orderItemId: order.orderitem[0].id, quantity: 1 }],
          reason: 'damaged',
        })
        .expect(400);
    });
  });

  describe('tenant isolation (adversarial)', () => {
    it("cannot create or view returns on another shop's order", async () => {
      const shopA = await setupShop('return-tenant-a');
      const shopB = await setupShop('return-tenant-b');
      const productA = await createProduct(shopA.adminToken, shopA.collectionId);
      await seedStock(shopA.adminToken, shopA.outletId, productA.id, 10);
      const orderA = await createDeliveredOrder(
        shopA.adminToken,
        shopA.outletId,
        productA.id,
        2,
      );

      await request(app.getHttpServer())
        .post(`/orders/${orderA.id}/returns`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          items: [{ orderItemId: orderA.orderitem[0].id, quantity: 1 }],
          reason: 'damaged',
        })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/orders/${orderA.id}/returns`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
    });
  });
});
