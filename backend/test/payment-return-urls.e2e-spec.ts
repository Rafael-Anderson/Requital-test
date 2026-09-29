import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import type {
  CheckoutSession,
  CreateCheckoutSessionParams,
  PaymentProvider,
} from '../src/payments/payment-provider.interface';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface PaymentLinkResponse {
  url: string;
  token: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

// A gateway's return URL was previously unobservable in any test, and it is
// exactly what broke: every provider was handed `${STOREFRONT_URL}/${slug}/...`,
// and STOREFRONT_URL is the apex whose only job in deploy/Caddyfile is a 301 to
// admin.requital.io. So this captures what each provider is ACTUALLY called
// with, for all four live gateways, without contacting anyone and with no real
// credentials.
//
// The stub registers under the same name as the real provider, so
// PublicService/PaymentsService resolve it exactly as they would the genuine one
// - this asserts the real wiring rather than reimplementing it.
class CapturingProvider implements PaymentProvider {
  readonly calls: CreateCheckoutSessionParams[] = [];
  constructor(readonly name: string) {}
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    this.calls.push(params);
    return Promise.resolve({
      checkoutUrl: 'https://stub.example/checkout',
      providerReference: `stub_${this.name}_${this.calls.length}`,
    });
  }
  parseWebhookEvent() {
    return null;
  }
}

// card_online resolves to shop.paymentGateway; the other three are
// INDEPENDENT_ONLINE_PROVIDERS, picked by paymentMethod directly and gated on
// their own shoppaymentprovider.enabled row (no row = not enabled, unlike
// stripe, whose no-row default is true).
const GATEWAYS = [
  { gateway: 'stripe', paymentMethod: 'card_online' },
  { gateway: 'tabby', paymentMethod: 'tabby' },
  { gateway: 'tamara', paymentMethod: 'tamara' },
  { gateway: 'paypal', paymentMethod: 'paypal' },
];

describe('Gateway return URLs are built per shop (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const stubs = new Map<string, CapturingProvider>();
  const ORIGINAL_STOREFRONT_URL = process.env.STOREFRONT_URL;

  beforeAll(async () => {
    // The whole suite runs the helper's PRODUCTION branch. That is deliberate
    // and load-bearing: STOREFRONT_URL is a localhost URL in the test env, and
    // on a local host the helper's dev branch emits the same
    // `<base>/<slug>/<path>` string the old buggy code did - so every assertion
    // below would pass against the bug it exists to catch. Deleting the var
    // (devPathBase() reads it per call) makes these tests assert the shape that
    // actually runs in production, where the old code emitted the apex.
    // The dev branch itself is covered in src/common/storefront-url.spec.ts.
    delete process.env.STOREFRONT_URL;
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

    const registry = app.get(PaymentProviderRegistry);
    for (const { gateway } of GATEWAYS) {
      const stub = new CapturingProvider(gateway);
      stubs.set(gateway, stub);
      registry.register(stub);
    }
  });

  afterAll(async () => {
    await app.close();
    if (ORIGINAL_STOREFRONT_URL !== undefined) {
      process.env.STOREFRONT_URL = ORIGINAL_STOREFRONT_URL;
    }
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Return URL Admin',
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
      .send({ name: 'Return URL Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Return URL Rose',
        price: 50,
        thumbnail: 'https://example.com/r.jpg',
        sku: `RET-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    // Publishing needs the readiness bar met (outlet + product); an
    // unpublished shop 404s every storefront order.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
      shopId: shopRows[0].id as number,
      slug,
    };
  }

  function placeOrder(
    shop: { slug: string; outletId: number; productId: number },
    paymentMethod: string,
  ) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Return URL Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup at outlet',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod,
        items: [{ productId: shop.productId, quantity: 1 }],
      });
  }

  function assertNotTheApexBug(url: string, slug: string) {
    // The bug: the apex 301-redirects to admin.requital.io, so a customer
    // finishing payment landed on the merchant login page.
    expect(url).not.toMatch(/^https?:\/\/requital\.io\b/);
    expect(url).not.toContain('admin.');
    // The other half: proxy.ts prepends the resolved slug to every non-local
    // request, so a slug already in the PATH doubles and 404s
    // (dff.requital.io/dff/orders/3 -> 404, proven live). The slug may appear
    // only as the host label.
    expect(url).not.toContain(`/${slug}/`);
  }

  describe.each(GATEWAYS)('$gateway', ({ gateway, paymentMethod }) => {
    it('receives success and cancel URLs built by the shared helper', async () => {
      const shop = await setupShop(`ret-${gateway}`);
      await db.execute(`UPDATE shop SET paymentGateway = ? WHERE id = ?`, [
        gateway,
        shop.shopId,
      ]);
      if (paymentMethod !== 'card_online') {
        await db.execute(
          `INSERT INTO shoppaymentprovider (shopId, provider, enabled)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE enabled = 1`,
          [shop.shopId, gateway],
        );
      }

      const stub = stubs.get(gateway)!;
      const before = stub.calls.length;
      await placeOrder(shop, paymentMethod).expect(201);

      expect(stub.calls.length).toBe(before + 1);
      const { successUrl, cancelUrl } = stub.calls[before];
      assertNotTheApexBug(successUrl, shop.slug);
      assertNotTheApexBug(cancelUrl, shop.slug);
      // This shop is on a plain subdomain, so its own host is the only correct
      // origin - the shape proven to serve 200.
      const origin = `https://${shop.slug}\\.requital\\.io`;
      expect(successUrl).toMatch(
        new RegExp(`^${origin}/orders/\\d+\\?paid=1$`),
      );
      expect(cancelUrl).toMatch(
        new RegExp(`^${origin}/checkout\\?orderId=\\d+$`),
      );
    });
  });

  describe('custom domains', () => {
    it('builds from the shop own verified custom domain, not the platform host', async () => {
      const shop = await setupShop('ret-verified');
      await db.execute(
        `UPDATE shop SET customDomain = ?, customDomainStatus = 'verified',
                domainType = 'custom' WHERE id = ?`,
        [`ret-cd-${runId}.example`, shop.shopId],
      );

      const stub = stubs.get('stripe')!;
      const before = stub.calls.length;
      await placeOrder(shop, 'card_online').expect(201);

      const { successUrl } = stub.calls[before];
      expect(successUrl).toContain(`https://ret-cd-${runId}.example/orders/`);
      // No slug in the path on a real host - the host IS the shop.
      expect(successUrl).not.toContain(shop.slug);
    });

    it('refuses an UNVERIFIED custom domain and falls back to the platform host', async () => {
      const shop = await setupShop('ret-unverified');
      await db.execute(
        `UPDATE shop SET customDomain = ?, customDomainStatus = NULL,
                domainType = 'custom' WHERE id = ?`,
        [`ret-unv-${runId}.example`, shop.shopId],
      );

      const stub = stubs.get('stripe')!;
      const before = stub.calls.length;
      await placeOrder(shop, 'card_online').expect(201);

      const { successUrl } = stub.calls[before];
      // Production really has shops in this state, and one of their claimed
      // domains serves an unrelated third-party website.
      expect(successUrl).not.toContain(`ret-unv-${runId}.example`);
      expect(successUrl).toContain(`https://${shop.slug}.`);
    });
  });

  describe('payment links', () => {
    it('point at the shop own host, and the summary endpoint never mints a session', async () => {
      const shop = await setupShop('ret-paylink');
      const order = await placeOrder(shop, 'cash_on_pickup').expect(201);
      const orderId = body<{ order: IdRow }>(order).order.id;

      const link = await request(app.getHttpServer())
        .post(`/orders/${orderId}/payment-link`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(201);
      const { url, token } = body<PaymentLinkResponse>(link);
      assertNotTheApexBug(url, shop.slug);
      expect(url).toContain(`/pay?token=${token}`);

      // The whole reason the summary route exists: the page needs an amount to
      // render, and GET /pay/:token writes paymentSessionId on every hit.
      const summary = await request(app.getHttpServer())
        .get(`/pay/${token}/summary`)
        .expect(200);
      expect(body<{ alreadyPaid: boolean }>(summary).alreadyPaid).toBe(false);

      const afterSummary = await db.query<RowDataPacket[]>(
        `SELECT paymentSessionId, paymentSessionGateway FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      expect(afterSummary[0].paymentSessionId).toBeNull();
      expect(afterSummary[0].paymentSessionGateway).toBeNull();

      // Repeated reads stay read-only - what a page polling on mount does.
      await request(app.getHttpServer())
        .get(`/pay/${token}/summary`)
        .expect(200);
      const stillClean = await db.query<RowDataPacket[]>(
        `SELECT paymentSessionId FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      expect(stillClean[0].paymentSessionId).toBeNull();

      // And the session-minting route, which the page only calls from "Pay
      // now", returns the /pay URLs through the same helper.
      const stub = stubs.get('stripe')!;
      const before = stub.calls.length;
      await request(app.getHttpServer()).get(`/pay/${token}`).expect(200);
      const { successUrl, cancelUrl } = stub.calls[before];
      assertNotTheApexBug(successUrl, shop.slug);
      assertNotTheApexBug(cancelUrl, shop.slug);
      expect(successUrl).toContain(`/pay/success?token=${token}`);
      expect(cancelUrl).toContain(`/pay?token=${token}`);

      const afterMint = await db.query<RowDataPacket[]>(
        `SELECT paymentSessionId FROM \`order\` WHERE id = ?`,
        [orderId],
      );
      expect(afterMint[0].paymentSessionId).not.toBeNull();
    });
  });
});
