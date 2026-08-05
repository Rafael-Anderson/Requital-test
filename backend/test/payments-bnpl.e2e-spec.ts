import 'dotenv/config';
import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AdminAuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderCreateResponse {
  order: { id: number };
}

function body<T>(res: Response): T {
  return res.body as T;
}

function sign(payload: Buffer | string, secret: string): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload) : payload;
  return createHmac('sha256', secret).update(buf).digest('hex');
}

// Several tests spin up two shops (two real signup calls, each firing a
// real verification-email network request) — same reasoning as
// scan.e2e-spec.ts's own jest.setTimeout(30000).
jest.setTimeout(30000);

describe('Tabby & Tamara payment webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  const TABBY_SECRET = 'tabby-webhook-secret-for-tests';
  const TAMARA_SECRET = 'tamara-notification-token-for-tests';

  beforeAll(async () => {
    process.env.TABBY_WEBHOOK_SECRET = TABBY_SECRET;
    process.env.TAMARA_NOTIFICATION_TOKEN = TAMARA_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
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
    delete process.env.TABBY_WEBHOOK_SECRET;
    delete process.env.TAMARA_NOTIFICATION_TOKEN;
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const shopSlug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Shop Admin',
        email: `${shopSlug}@test.com`,
        password: 'password123',
        shopName: `${shopSlug} Shop`,
        subdomain: shopSlug,
      })
      .expect(201);
    const adminToken = body<AdminAuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AdminAuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'BNPL Test Product',
        price: 300,
        thumbnail: 'https://example.com/x.jpg',
        sku: `BNPL-${slugPrefix}-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { shopSlug, adminToken, outletId, productId };
  }

  // Order status is driven purely by the webhook's own orderId resolution
  // (never a claimed shopId in the payload) — how the order was originally
  // created doesn't matter for testing that behavior, so a plain
  // cash-on-pickup order stands in for "a pending order this shop is
  // waiting on payment for" without needing to also wire up BNPL's
  // storefront checkout-method selection (out of this task's scope).
  function createPendingOrder(
    shopSlug: string,
    outletId: number,
    productId: number,
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Shopper',
        customerPhone: '0501234567',
        customerAddress: '1 Test St',
        emirate: 'Dubai',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
  }

  describe('Tabby', () => {
    function tabbyPayload(
      event: string,
      orderId: number,
      eventId = `evt_${Math.random()}`,
    ) {
      return JSON.stringify({
        id: eventId,
        event,
        payment: {
          id: `pay_${orderId}`,
          order: { reference_id: String(orderId) },
        },
      });
    }

    it('a validly-signed payment.approved event confirms the order via the existing CAS state machine', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tabby-approve');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const payload = tabbyPayload('payment.approved', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', sign(payload, TABBY_SECRET))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const updated = body<{ status: string; paymentStatus: string }>(detail);
      expect(updated.status).toBe('confirmed');
      expect(updated.paymentStatus).toBe('paid');
    });

    it('payment.expired cancels a still-pending order', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tabby-expire');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const payload = tabbyPayload('payment.expired', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', sign(payload, TABBY_SECRET))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detail).status).toBe('cancelled');
    });

    it('a tampered signature is rejected — the order is never touched', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tabby-tamper');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const payload = tabbyPayload('payment.approved', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', sign(payload, 'wrong-secret'))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201); // webhook endpoint itself still returns 200 — see PaymentsService discipline

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        body<{ status: string; paymentStatus: string }>(detail),
      ).toMatchObject({
        status: 'pending',
        paymentStatus: 'unpaid',
      });
    });

    it('the same event id delivered twice is idempotent — confirmed exactly once, one paymenttransaction row', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tabby-idempotent');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      // gatewayReference (event id) is unique per (gateway, gatewayReference)
      // globally in the DB, not scoped to this test run — a literal fixed
      // string would collide with a prior run's row against this same
      // persistent dev database and cause a false P2002 on the *first*
      // delivery here, not just the intended second one.
      const payload = tabbyPayload(
        'payment.approved',
        order.id,
        `evt_fixed_${runId}`,
      );
      const signature = sign(payload, TABBY_SECRET);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const rows = await prisma.paymenttransaction.findMany({
        where: { orderId: order.id, gateway: 'tabby' },
      });
      expect(rows).toHaveLength(1);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detail).status).toBe('confirmed');
    });

    it("does not affect a different shop's order — webhook resolution is scoped by the order's own real shopId, never a claimed one", async () => {
      const shopA = await setupShop('tabby-iso-a');
      const shopB = await setupShop('tabby-iso-b');
      const orderA = body<OrderCreateResponse>(
        await createPendingOrder(
          shopA.shopSlug,
          shopA.outletId,
          shopA.productId,
        ),
      ).order;
      const orderB = body<OrderCreateResponse>(
        await createPendingOrder(
          shopB.shopSlug,
          shopB.outletId,
          shopB.productId,
        ),
      ).order;

      const payload = tabbyPayload('payment.approved', orderA.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', sign(payload, TABBY_SECRET))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detailA = await request(app.getHttpServer())
        .get(`/orders/${orderA.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detailA).status).toBe('confirmed');

      const detailB = await request(app.getHttpServer())
        .get(`/orders/${orderB.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detailB).status).toBe('pending'); // untouched
    });

    it('a stale approval on an order the merchant already moved past pending is ignored, not forced through', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tabby-stale');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'preparing' })
        .expect(200);

      const payload = tabbyPayload('payment.expired', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tabby')
        .set('x-tabby-signature', sign(payload, TABBY_SECRET))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detail).status).toBe('preparing'); // not cancelled
    });
  });

  describe('Tamara', () => {
    function tamaraPayload(eventType: string, orderId: number) {
      return JSON.stringify({
        order_id: `tamara_order_${orderId}`,
        order_reference_id: String(orderId),
        event_type: eventType,
      });
    }

    it('a validly-signed order_approved event confirms the order', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tamara-approve');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const payload = tamaraPayload('order_approved', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tamara')
        .set('x-tamara-signature', sign(payload, TAMARA_SECRET))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const updated = body<{ status: string; paymentStatus: string }>(detail);
      expect(updated.status).toBe('confirmed');
      expect(updated.paymentStatus).toBe('paid');
    });

    it('order_declined cancels a still-pending order', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tamara-decline');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const payload = tamaraPayload('order_declined', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tamara')
        .set('x-tamara-signature', sign(payload, TAMARA_SECRET))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detail).status).toBe('cancelled');
    });

    it('a tampered signature is rejected — the order is never touched', async () => {
      const { shopSlug, outletId, productId, adminToken } =
        await setupShop('tamara-tamper');
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const payload = tamaraPayload('order_approved', order.id);
      await request(app.getHttpServer())
        .post('/payments/webhook/tamara')
        .set('x-tamara-signature', sign(payload, 'wrong-secret'))
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ status: string }>(detail).status).toBe('pending');
    });

    it('missing webhook secret configuration throws PaymentProviderNotConfiguredException (surfaced as a 500)', async () => {
      const { shopSlug, outletId, productId } = await setupShop(
        'tamara-unconfigured',
      );
      const order = body<OrderCreateResponse>(
        await createPendingOrder(shopSlug, outletId, productId),
      ).order;

      const original = process.env.TAMARA_NOTIFICATION_TOKEN;
      delete process.env.TAMARA_NOTIFICATION_TOKEN;
      try {
        const payload = tamaraPayload('order_approved', order.id);
        await request(app.getHttpServer())
          .post('/payments/webhook/tamara')
          .set('x-tamara-signature', sign(payload, TAMARA_SECRET))
          .set('Content-Type', 'application/json')
          .send(payload)
          .expect(500);
      } finally {
        process.env.TAMARA_NOTIFICATION_TOKEN = original;
      }
    });
  });
});
