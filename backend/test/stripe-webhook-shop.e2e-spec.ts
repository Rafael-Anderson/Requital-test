import 'dotenv/config';

// Set BEFORE the Nest testing module compiles below (module-load-time
// statement, ahead of the beforeAll that calls .compile()) — StripePaymentProvider
// reads this once into a readonly field at construction time, so it must be
// in place before that provider is ever instantiated. Restored in afterAll
// so this test file doesn't leak a fake platform secret into any other e2e
// file sharing the same worker process.
const ORIGINAL_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_e2e_test_secret';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
  user: { shopId: number };
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface OrderRow {
  id: number;
  paymentStatus: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// A bare-bones instance purely to reach `.webhooks` (pure local HMAC
// helpers, no network calls, no real API key needed) — same utility the
// provider itself uses to verify, used here in reverse to sign.
const stripeUtil = new Stripe('sk_test_dummy_key_for_local_webhook_signing');

function signEvent(payload: string, secret: string): string {
  return stripeUtil.webhooks.generateTestHeaderString({ payload, secret });
}

function stripeEventPayload(eventId: string, orderId: number): string {
  return JSON.stringify({
    id: eventId,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${eventId}`,
        object: 'checkout.session',
        metadata: { orderId: String(orderId) },
      },
    },
  });
}

describe('Per-shop Stripe webhook routing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    // rawBody: true — mirrors main.ts's NestFactory.create options exactly.
    // Without it, request.rawBody is never populated and the webhook
    // handler's signature verification fails on "No webhook payload was
    // provided," regardless of whether the signature itself is correct.
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
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_STRIPE_WEBHOOK_SECRET;
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShopWithOrder(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Webhook Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    const auth = body<AuthResponse>(signup);
    const adminToken = auth.accessToken;
    const shopId = auth.user.shopId;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose',
        price: 50,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `WH-${slugPrefix}-${runId}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Webhook Test Customer',
        customerPhone: '0501234567',
        customerAddress: 'Store pickup',
        emirate: 'Dubai',
        outletId,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<IdRow>(order).id;

    return { adminToken, shopId, orderId };
  }

  async function saveStripeWebhookSecret(
    adminToken: string,
    webhookSecret: string,
  ) {
    await request(app.getHttpServer())
      .patch('/payment-settings/stripe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentials: { webhookSecret } })
      .expect(200);
  }

  async function getOrder(adminToken: string, orderId: number) {
    const res = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return body<OrderRow>(res);
  }

  it("a shop-specific event verifies correctly against that shop's own webhook secret and marks the order paid", async () => {
    const shop = await setupShopWithOrder('wh-own-secret');
    await saveStripeWebhookSecret(shop.adminToken, 'whsec_own_secret_1');

    const payload = stripeEventPayload(`evt_own_${runId}`, shop.orderId);
    const signature = signEvent(payload, 'whsec_own_secret_1');

    await request(app.getHttpServer())
      .post(`/payments/webhook/stripe/${shop.shopId}`)
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const order = await getOrder(shop.adminToken, shop.orderId);
    expect(order.paymentStatus).toBe('paid');
  });

  it("an event sent to a different shop's URL fails signature verification (each shop's secret is genuinely its own)", async () => {
    const shopA = await setupShopWithOrder('wh-cross-sig-a');
    const shopB = await setupShopWithOrder('wh-cross-sig-b');
    await saveStripeWebhookSecret(shopA.adminToken, 'whsec_shop_a_secret');
    await saveStripeWebhookSecret(shopB.adminToken, 'whsec_shop_b_secret');

    const payload = stripeEventPayload(`evt_cross_sig_${runId}`, shopA.orderId);
    // Signed with A's secret, sent to B's URL — B's route verifies against
    // B's own (different) secret, so this must fail signature verification.
    const signature = signEvent(payload, 'whsec_shop_a_secret');

    await request(app.getHttpServer())
      .post(`/payments/webhook/stripe/${shopB.shopId}`)
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(500);

    const orderA = await getOrder(shopA.adminToken, shopA.orderId);
    expect(orderA.paymentStatus).toBe('unpaid');
  });

  it("a validly-signed event referencing a DIFFERENT shop's order is ignored, not applied cross-tenant (defense in depth beyond signature verification)", async () => {
    const shopA = await setupShopWithOrder('wh-cross-order-a');
    const shopB = await setupShopWithOrder('wh-cross-order-b');
    await saveStripeWebhookSecret(shopB.adminToken, 'whsec_shop_b_own_secret');

    // Genuinely valid for shop B's URL (signed with B's own real secret) —
    // but the orderId inside the payload belongs to shop A.
    const payload = stripeEventPayload(
      `evt_cross_order_${runId}`,
      shopA.orderId,
    );
    const signature = signEvent(payload, 'whsec_shop_b_own_secret');

    await request(app.getHttpServer())
      .post(`/payments/webhook/stripe/${shopB.shopId}`)
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const orderA = await getOrder(shopA.adminToken, shopA.orderId);
    expect(orderA.paymentStatus).toBe('unpaid');
  });

  it('a shop with no stripe webhook secret configured gets a clean rejection, not a crash', async () => {
    const shop = await setupShopWithOrder('wh-unconfigured');
    const payload = stripeEventPayload(
      `evt_unconfigured_${runId}`,
      shop.orderId,
    );
    const signature = signEvent(payload, 'whsec_whatever');

    await request(app.getHttpServer())
      .post(`/payments/webhook/stripe/${shop.shopId}`)
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(400);
  });

  it('the platform-level route (no shopId) still works for a shop that never configured its own Stripe credentials', async () => {
    const shop = await setupShopWithOrder('wh-platform');
    const payload = stripeEventPayload(`evt_platform_${runId}`, shop.orderId);
    const signature = signEvent(payload, 'whsec_platform_e2e_test_secret');

    await request(app.getHttpServer())
      .post('/payments/webhook/stripe')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const order = await getOrder(shop.adminToken, shop.orderId);
    expect(order.paymentStatus).toBe('paid');
  });
});
