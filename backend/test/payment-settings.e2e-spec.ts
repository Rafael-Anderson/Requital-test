import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface ProviderRow {
  provider: string;
  enabled: boolean;
  isCardProcessor: boolean;
  hasCredentials: boolean;
  maskedCredentials: Record<string, string> | null;
}
interface PublicShopBody {
  cardProcessorEnabled: boolean;
  enabledPaymentProviders: string[];
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

describe('Payment Settings (e2e)', () => {
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
        name: 'Payments Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    return {
      adminToken: body<AuthResponse>(signup).accessToken,
      slug: `${slugPrefix}-${runId}`,
    };
  }

  function findProvider(rows: ProviderRow[], provider: string) {
    return rows.find((r) => r.provider === provider)!;
  }

  describe('GET /payment-settings defaults for an unconfigured shop', () => {
    it('stripe reads as enabled (legacy default), nomod/paypal/tabby/tamara read as disabled, cod matches shop defaults', async () => {
      const shop = await setupShop('pay-default');
      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rows = body<ProviderRow[]>(res);

      expect(findProvider(rows, 'stripe').enabled).toBe(true);
      expect(findProvider(rows, 'nomod').enabled).toBe(false);
      expect(findProvider(rows, 'paypal').enabled).toBe(false);
      expect(findProvider(rows, 'tabby').enabled).toBe(false);
      expect(findProvider(rows, 'tamara').enabled).toBe(false);
      // Shop defaults: deliveryPaymentCashOnDelivery/pickupPaymentCashOnPickup both default true.
      expect(findProvider(rows, 'cod').enabled).toBe(true);
      expect(findProvider(rows, 'stripe').hasCredentials).toBe(false);
      expect(findProvider(rows, 'stripe').maskedCredentials).toBeNull();
    });
  });

  describe('PATCH /payment-settings/:provider — credential storage, masking, encryption', () => {
    it('saves credentials, never returns them in plaintext, and masks with only the last 4 characters visible', async () => {
      const shop = await setupShop('pay-creds');
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          credentials: {
            secretKey: 'sk_live_abcdefgh1234',
            webhookSecret: 'whsec_zzzz9999',
          },
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const stripe = findProvider(body<ProviderRow[]>(res), 'stripe');
      expect(stripe.hasCredentials).toBe(true);
      expect(stripe.maskedCredentials).toEqual({
        secretKey: '••••1234',
        webhookSecret: '••••9999',
      });
      // Never the real value anywhere in the response.
      expect(JSON.stringify(res.body)).not.toContain('sk_live_abcdefgh1234');
      expect(JSON.stringify(res.body)).not.toContain('whsec_zzzz9999');
    });

    it('saves and masks all 3 PayPal credential fields (clientId/clientSecret/webhookId)', async () => {
      const shop = await setupShop('pay-paypal-creds');
      await request(app.getHttpServer())
        .patch('/payment-settings/paypal')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          credentials: {
            clientId: 'AeClientId1234',
            clientSecret: 'EcSecret5678',
            webhookId: 'WH-webhookid9012',
          },
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const paypal = findProvider(body<ProviderRow[]>(res), 'paypal');
      expect(paypal.hasCredentials).toBe(true);
      expect(paypal.maskedCredentials).toEqual({
        clientId: '••••1234',
        clientSecret: '••••5678',
        webhookId: '••••9012',
      });
      expect(JSON.stringify(res.body)).not.toContain('AeClientId1234');
      expect(JSON.stringify(res.body)).not.toContain('EcSecret5678');
      expect(JSON.stringify(res.body)).not.toContain('WH-webhookid9012');
    });

    it('is never stored in plaintext in the database either', async () => {
      const shop = await setupShop('pay-encrypted-at-rest');
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          credentials: {
            secretKey: 'sk_live_super_secret_value_999',
            webhookSecret: 'whsec_abc',
          },
        })
        .expect(200);

      const row = await prisma.shoppaymentprovider.findFirst({
        where: { provider: 'stripe', shop: { subdomain: shop.slug } },
      });
      expect(row?.credentials).toBeTruthy();
      expect(row!.credentials).not.toContain('sk_live_super_secret_value_999');
      expect(row!.credentials).not.toContain('whsec_abc');
    });

    it('saving credentials alone (no enabled field) does not silently disable an implicitly-enabled card processor', async () => {
      const shop = await setupShop('pay-creds-preserve-enabled');
      // stripe has no row yet — reads as enabled (legacy default).
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          credentials: { secretKey: 'sk_live_x', webhookSecret: 'whsec_x' },
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(findProvider(body<ProviderRow[]>(res), 'stripe').enabled).toBe(
        true,
      );
    });

    it('rejects an unknown credential field for a provider', async () => {
      const shop = await setupShop('pay-bad-field');
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/tabby')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ credentials: { notARealField: 'x' } })
        .expect(400);
      expect(messageContains(res, 'notARealField')).toBe(true);
    });

    it('rejects an unknown provider name', async () => {
      const shop = await setupShop('pay-bad-provider');
      await request(app.getHttpServer())
        .patch('/payment-settings/not-a-real-gateway')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true })
        .expect(400);
    });
  });

  describe('Card processor exclusivity (Nomod vs Stripe)', () => {
    it('enabling Nomod while Stripe is active (implicit default) is rejected with a clear message', async () => {
      const shop = await setupShop('pay-exclusive-a');
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          enabled: true,
          credentials: { apiKey: 'key', secretKey: 'secret' },
        })
        .expect(400);
      expect(messageContains(res, 'Disable Stripe')).toBe(true);
    });

    it('disabling Stripe first, then enabling Nomod, succeeds — and Stripe no longer reads as enabled', async () => {
      const shop = await setupShop('pay-exclusive-b');
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          enabled: true,
          credentials: { apiKey: 'key', secretKey: 'secret' },
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rows = body<ProviderRow[]>(res);
      expect(findProvider(rows, 'nomod').enabled).toBe(true);
      expect(findProvider(rows, 'stripe').enabled).toBe(false);
    });

    it('enabling Nomod while Stripe is inactive, then trying to enable Stripe, is rejected the other direction too', async () => {
      const shop = await setupShop('pay-exclusive-c');
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/payment-settings/nomod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true })
        .expect(400);
      expect(messageContains(res, 'Disable Nomod')).toBe(true);
    });

    it('re-enabling Stripe while Nomod was never enabled succeeds', async () => {
      const shop = await setupShop('pay-exclusive-d');
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(findProvider(body<ProviderRow[]>(res), 'stripe').enabled).toBe(
        true,
      );
    });

    it('enabling PayPal/Tabby/Tamara/COD never triggers the exclusivity check, regardless of card-processor state', async () => {
      const shop = await setupShop('pay-independent');
      // Stripe stays at its implicit-enabled default the whole time.
      for (const provider of ['paypal', 'tabby', 'tamara']) {
        await request(app.getHttpServer())
          .patch(`/payment-settings/${provider}`)
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ enabled: true })
          .expect(200);
      }
      await request(app.getHttpServer())
        .patch('/payment-settings/cod')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const rows = body<ProviderRow[]>(res);
      expect(findProvider(rows, 'stripe').enabled).toBe(true);
      expect(findProvider(rows, 'paypal').enabled).toBe(true);
      expect(findProvider(rows, 'tabby').enabled).toBe(true);
      expect(findProvider(rows, 'tamara').enabled).toBe(true);
      expect(findProvider(rows, 'cod').enabled).toBe(false);
    });
  });

  describe('multi-tenant isolation', () => {
    it("shop A's payment settings (enabled state and credentials) never appear on shop B's GET, or in shop B's public payload", async () => {
      const shopA = await setupShop('pay-iso-a');
      const shopB = await setupShop('pay-iso-b');

      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          credentials: {
            secretKey: 'sk_live_shopA_only',
            webhookSecret: 'whsec_shopA',
          },
        })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/payment-settings/paypal')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          enabled: true,
          credentials: {
            clientId: 'a',
            clientSecret: 'b',
            webhookId: 'shopA-webhook-id',
          },
        })
        .expect(200);

      const settingsB = await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      const rowsB = body<ProviderRow[]>(settingsB);
      expect(findProvider(rowsB, 'stripe').hasCredentials).toBe(false);
      expect(findProvider(rowsB, 'paypal').enabled).toBe(false);
      expect(findProvider(rowsB, 'paypal').hasCredentials).toBe(false);
      expect(JSON.stringify(settingsB.body)).not.toContain('shopA');
      expect(JSON.stringify(settingsB.body)).not.toContain('shopA-webhook-id');

      const publicB = await request(app.getHttpServer())
        .get(`/public/${shopB.slug}`)
        .expect(200);
      expect(
        body<PublicShopBody>(publicB).enabledPaymentProviders,
      ).not.toContain('paypal');
    });
  });

  describe('permission boundary: payment settings are admin-only', () => {
    it('a branch user gets 403 on GET/PATCH; the admin gets 200', async () => {
      const shop = await setupShop('pay-perm');
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const outletId = body<OutletRow[]>(outlets)[0].id;

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `pay-branch-${runId}@test.com`,
          password: 'password123',
          outletId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `pay-branch-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .patch('/payment-settings/paypal')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ enabled: true })
        .expect(403);
      await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
    });
  });

  describe('PATCH /shop no longer accepts paymentGateway directly (moved behind exclusivity enforcement)', () => {
    it('a direct PATCH /shop call with paymentGateway is rejected, not silently ignored or applied', async () => {
      const shop = await setupShop('pay-shop-endpoint-blocked');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ paymentGateway: 'nomod' })
        .expect(400);
    });
  });

  describe('storefront reflects only enabled providers for the correct shop', () => {
    async function setupOrderableShop(slugPrefix: string) {
      const shop = await setupShop(slugPrefix);
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const outletId = body<OutletRow[]>(outlets)[0].id;
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          active: true,
          emirate: 'Dubai',
          deliveryEnabled: true,
          pickupEnabled: true,
          latitude: 25.2048,
          longitude: 55.2708,
          deliveryRadiusKm: 5,
        })
        .expect(200);
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ name: 'Flowers' })
        .expect(201);
      const collectionId = body<IdRow>(collection).id;
      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Rose',
          price: 50,
          thumbnail: 'https://example.com/rose.jpg',
          sku: `PAY-${slugPrefix}-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(product).id;
      // Publishing requires meeting the readiness bar (outlet + product must
      // already exist — see ShopService.getPublishReadiness). Storefront
      // order creation then 404s for an unpublished shop (see
      // PublicService.assertPublished) — this suite creates storefront orders.
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(200);
      return { ...shop, outletId, productId };
    }

    it('GET /public/:slug lists exactly the providers enabled for that shop', async () => {
      const shop = await setupOrderableShop('pay-storefront');
      let res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(body<PublicShopBody>(res).enabledPaymentProviders).toEqual([]);
      expect(body<PublicShopBody>(res).cardProcessorEnabled).toBe(true);

      await request(app.getHttpServer())
        .patch('/payment-settings/tabby')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true })
        .expect(200);

      res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(body<PublicShopBody>(res).enabledPaymentProviders).toEqual([
        'tabby',
      ]);
    });

    it('a checkout attempt with an unenabled independent provider is rejected', async () => {
      const shop = await setupOrderableShop('pay-checkout-reject');
      const res = await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletId,
          orderType: 'delivery',
          paymentMethod: 'tabby',
          customerName: 'Test Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(400);
      expect(messageContains(res, 'tabby')).toBe(true);
    });

    it('once enabled, checkout accepts the order (creating it) even though the stub gateway itself then fails — matches the existing card_online-with-a-stub-gateway behavior', async () => {
      const shop = await setupOrderableShop('pay-checkout-accept');
      await request(app.getHttpServer())
        .patch('/payment-settings/tabby')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: true })
        .expect(200);

      // The order is created (stock reserved, row committed) before the
      // stub gateway call throws — same documented behavior as card_online
      // against an unconfigured/stub gateway. The HTTP response is a 500
      // (the throw propagates), not a clean rejection, because this is a
      // genuine "gateway is a stub" condition, not a validation failure.
      await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletId,
          orderType: 'delivery',
          paymentMethod: 'tabby',
          customerName: 'Test Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          // Required because setupOrderableShop configures deliveryRadiusKm
          // — otherwise the radius check 400s before ever reaching the
          // tabby stub, which isn't what this test is about.
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(500);

      const order = await prisma.order.findFirst({
        where: { shop: { subdomain: shop.slug }, paymentMethod: 'tabby' },
      });
      expect(order).toBeTruthy();
    });

    it('card_online is rejected once the shop explicitly disables its only card processor', async () => {
      const shop = await setupOrderableShop('pay-card-online-disabled');
      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ enabled: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletId,
          orderType: 'delivery',
          paymentMethod: 'card_online',
          customerName: 'Test Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(400);
      expect(messageContains(res, 'Online card payment')).toBe(true);
    });
  });
});
