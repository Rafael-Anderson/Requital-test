import 'dotenv/config';
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

const PAYPAL_HEADERS = {
  'paypal-transmission-id': 'tid',
  'paypal-transmission-time': '2026-01-01T00:00:00Z',
  'paypal-cert-url': 'https://api.paypal.com/cert',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-transmission-sig': 'sig',
};

// This is the first webhook e2e spec in the repo that needs to mock
// global.fetch to verify at all — every other gateway here (Tabby/Tamara)
// verifies its webhook signature with a local HMAC computation the test can
// just re-derive; PayPal's verification is itself a remote API call (see
// PayPalPaymentProvider.parseWebhookEvent), so "tampered" vs. "valid" here
// means mocking that remote verify-webhook-signature response, not signing
// with the wrong secret.
jest.setTimeout(30000);

describe('PayPal payment webhook (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fetchSpy: jest.SpyInstance;
  const runId = Date.now();

  const CLIENT_ID = `paypal-client-${runId}`;
  const CLIENT_SECRET = 'paypal-secret-for-tests';
  const WEBHOOK_ID = `paypal-webhook-id-${runId}`;

  beforeAll(async () => {
    process.env.PAYPAL_CLIENT_ID = CLIENT_ID;
    process.env.PAYPAL_CLIENT_SECRET = CLIENT_SECRET;
    process.env.PAYPAL_WEBHOOK_ID = WEBHOOK_ID;

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
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.PAYPAL_WEBHOOK_ID;
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // Routed by URL, not queued by call order: PayPalPaymentProvider caches
  // its OAuth access token by clientId across calls (see getAccessToken), so
  // whether a given test's webhook delivery actually triggers a fresh
  // /v1/oauth2/token call depends on whether an earlier test in this file
  // already populated the cache for the same env-var clientId. A
  // mockResolvedValueOnce chain assuming a fixed call count/order breaks the
  // moment that caching kicks in; matching by URL substring is robust to it.
  function mockPayPalApi(verificationStatus: string) {
    fetchSpy.mockImplementation(async (url: string) => {
      if (String(url).includes('/v1/oauth2/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'fake-token', expires_in: 3600 }),
        };
      }
      if (String(url).includes('/v1/notifications/verify-webhook-signature')) {
        return {
          ok: true,
          json: async () => ({ verification_status: verificationStatus }),
        };
      }
      throw new Error(`Unexpected fetch call in test: ${String(url)}`);
    });
  }

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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'PayPal Test Product',
        price: 300,
        thumbnail: 'https://example.com/x.jpg',
        sku: `PAYPAL-${slugPrefix}-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
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

  function paypalEvent(
    eventType: string,
    orderId: number,
    resourceId: string,
    eventId = `WH-EVT-${Math.random()}`,
  ) {
    return JSON.stringify({
      id: eventId,
      event_type: eventType,
      resource: { id: resourceId, custom_id: String(orderId) },
    });
  }

  it('a validly-verified PAYMENT.CAPTURE.COMPLETED event marks the order paid, without advancing its status (not BNPL)', async () => {
    const { shopSlug, outletId, productId, adminToken } =
      await setupShop('paypal-paid');
    const order = body<OrderCreateResponse>(
      await createPendingOrder(shopSlug, outletId, productId),
    ).order;
    mockPayPalApi('SUCCESS');

    const payload = paypalEvent(
      'PAYMENT.CAPTURE.COMPLETED',
      order.id,
      `CAPTURE-${order.id}`,
    );
    await request(app.getHttpServer())
      .post('/payments/webhook/paypal')
      .set(PAYPAL_HEADERS)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const updated = body<{ status: string; paymentStatus: string }>(detail);
    expect(updated.paymentStatus).toBe('paid');
    // PayPal isn't BNPL — payment success never implies order confirmation
    // here, same as Stripe.
    expect(updated.status).toBe('pending');
  });

  it('a failed verification_status is a safe no-op — the order is never touched', async () => {
    const { shopSlug, outletId, productId, adminToken } =
      await setupShop('paypal-unverified');
    const order = body<OrderCreateResponse>(
      await createPendingOrder(shopSlug, outletId, productId),
    ).order;
    mockPayPalApi('FAILURE');

    const payload = paypalEvent(
      'PAYMENT.CAPTURE.COMPLETED',
      order.id,
      `CAPTURE-${order.id}`,
    );
    await request(app.getHttpServer())
      .post('/payments/webhook/paypal')
      .set(PAYPAL_HEADERS)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201); // webhook endpoint itself still returns 200 — see PaymentsService discipline

    const detail = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      body<{ status: string; paymentStatus: string }>(detail),
    ).toMatchObject({ status: 'pending', paymentStatus: 'unpaid' });
  });

  it('the same event id delivered twice is idempotent — one paymenttransaction row', async () => {
    const { shopSlug, outletId, productId } = await setupShop('paypal-idem');
    const order = body<OrderCreateResponse>(
      await createPendingOrder(shopSlug, outletId, productId),
    ).order;

    const payload = paypalEvent(
      'PAYMENT.CAPTURE.COMPLETED',
      order.id,
      `CAPTURE-${order.id}`,
      `WH-EVT-fixed-${runId}`,
    );

    mockPayPalApi('SUCCESS');
    await request(app.getHttpServer())
      .post('/payments/webhook/paypal')
      .set(PAYPAL_HEADERS)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    mockPayPalApi('SUCCESS');
    await request(app.getHttpServer())
      .post('/payments/webhook/paypal')
      .set(PAYPAL_HEADERS)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const rows = await prisma.paymenttransaction.findMany({
      where: { orderId: order.id, gateway: 'paypal' },
    });
    expect(rows).toHaveLength(1);
  });

  it("does not affect a different shop's order — webhook resolution is scoped by the order's own real shopId, never a claimed one", async () => {
    const shopA = await setupShop('paypal-iso-a');
    const shopB = await setupShop('paypal-iso-b');
    const orderA = body<OrderCreateResponse>(
      await createPendingOrder(shopA.shopSlug, shopA.outletId, shopA.productId),
    ).order;
    const orderB = body<OrderCreateResponse>(
      await createPendingOrder(shopB.shopSlug, shopB.outletId, shopB.productId),
    ).order;
    mockPayPalApi('SUCCESS');

    const payload = paypalEvent(
      'PAYMENT.CAPTURE.COMPLETED',
      orderA.id,
      `CAPTURE-${orderA.id}`,
    );
    await request(app.getHttpServer())
      .post('/payments/webhook/paypal')
      .set(PAYPAL_HEADERS)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const detailA = await request(app.getHttpServer())
      .get(`/orders/${orderA.id}`)
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<{ paymentStatus: string }>(detailA).paymentStatus).toBe('paid');

    const detailB = await request(app.getHttpServer())
      .get(`/orders/${orderB.id}`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .expect(200);
    expect(body<{ paymentStatus: string }>(detailB).paymentStatus).toBe(
      'unpaid',
    ); // untouched
  });

  it('missing platform PayPal credentials throws PaymentProviderNotConfiguredException (surfaced as a 500)', async () => {
    const { shopSlug, outletId, productId } = await setupShop(
      'paypal-unconfigured',
    );
    const order = body<OrderCreateResponse>(
      await createPendingOrder(shopSlug, outletId, productId),
    ).order;

    const originalClientId = process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_ID;
    try {
      const payload = paypalEvent(
        'PAYMENT.CAPTURE.COMPLETED',
        order.id,
        `CAPTURE-${order.id}`,
      );
      await request(app.getHttpServer())
        .post('/payments/webhook/paypal')
        .set(PAYPAL_HEADERS)
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(500);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.PAYPAL_CLIENT_ID = originalClientId;
    }
  });

  it('a per-shop route with no configured PayPal credentials 400s before ever verifying', async () => {
    const { shopSlug, outletId, productId, adminToken } = await setupShop(
      'paypal-per-shop-unconfigured',
    );
    const order = body<OrderCreateResponse>(
      await createPendingOrder(shopSlug, outletId, productId),
    ).order;
    const shopId = (
      await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    ).shopId;
    void adminToken;

    const payload = paypalEvent(
      'PAYMENT.CAPTURE.COMPLETED',
      order.id,
      `CAPTURE-${order.id}`,
    );
    await request(app.getHttpServer())
      .post(`/payments/webhook/paypal/${shopId}`)
      .set(PAYPAL_HEADERS)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
