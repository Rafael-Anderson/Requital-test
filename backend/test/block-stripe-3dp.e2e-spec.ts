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

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(240000);

// Stripe card checkout is blocked for KWD/BHD/OMR (blocked-gateway-currencies.ts)
// until the owner decides the handling. The provider-internal guard is covered in
// stripe-payment.provider.spec.ts; this proves the EARLY rejections: no orphan
// order, a clear 400/409, the storefront hiding "Pay online", and that cash,
// AED and the other gateways are untouched.
class CapturingStripe implements PaymentProvider {
  readonly name = 'stripe';
  readonly calls: CreateCheckoutSessionParams[] = [];
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    this.calls.push(params);
    return Promise.resolve({
      checkoutUrl: 'https://stub.example/checkout',
      providerReference: `stub_3dp_${this.calls.length}`,
    });
  }
  parseWebhookEvent() {
    return null;
  }
}

describe('Stripe blocked for 3-decimal currencies (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const stripe = new CapturingStripe();
  let adminToken: string;
  let slug: string;
  let shopId: number;
  let outletId: number;
  let productId: number;

  const setCurrency = (currency: string) =>
    request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currency })
      .expect(200);

  const placeOrder = (paymentMethod: string) =>
    request(app.getHttpServer())
      .post(`/public/${slug}/orders`)
      .send({
        outletId,
        customerName: '3DP Customer',
        customerPhone: '0501112222',
        customerAddress: 'Pickup',
        orderType: 'pickup',
        paymentMethod,
        items: [{ productId, quantity: 1 }],
      });

  const orderCount = async () => {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM \`order\` WHERE shopId = ?`,
      [shopId],
    );
    return Number(rows[0].n);
  };

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
    app.get(PaymentProviderRegistry).register(stripe);

    slug = `b3dp-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: '3DP Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '3DP Goods' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '3DP Bouquet',
        price: 10.5,
        thumbnail: 'https://example.com/k.jpg',
        sku: `B3DP-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    productId = body<IdRow>(product).id;
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
    const shopRows = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    shopId = shopRows[0].id as number;
  });

  afterAll(async () => {
    await app.close();
  });

  it('AED is unchanged: the storefront offers card and a card order reaches the gateway', async () => {
    await setCurrency('AED');
    const shopRes = await request(app.getHttpServer())
      .get(`/public/${slug}`)
      .expect(200);
    expect(
      body<{ cardProcessorEnabled: boolean }>(shopRes).cardProcessorEnabled,
    ).toBe(true);
    const res = await placeOrder('card_online').expect(201);
    expect(body<{ checkoutUrl: string | null }>(res).checkoutUrl).toBe(
      'https://stub.example/checkout',
    );
    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0].currency).toBe('AED');
  });

  describe.each(['KWD', 'BHD', 'OMR'])('%s shop', (currency) => {
    beforeAll(async () => {
      await setCurrency(currency);
    });

    it('getShop hides card checkout (cardProcessorEnabled is false)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/${slug}`)
        .expect(200);
      const payload = body<{
        cardProcessorEnabled: boolean;
        currency: string;
      }>(res);
      expect(payload.currency).toBe(currency);
      expect(payload.cardProcessorEnabled).toBe(false);
    });

    it('a card order is refused with a clean 400, creates no order and never calls the gateway', async () => {
      const before = await orderCount();
      const calls = stripe.calls.length;
      const res = await placeOrder('card_online').expect(400);
      expect(JSON.stringify(res.body)).toContain('Online card payment');
      expect(await orderCount()).toBe(before);
      expect(stripe.calls).toHaveLength(calls);
    });

    it('cash on pickup still works', async () => {
      const before = await orderCount();
      await placeOrder('cash_on_pickup').expect(201);
      expect(await orderCount()).toBe(before + 1);
    });
  });

  it('a payment link cannot be created for a KWD order (400), and an old link answers 409 without a session', async () => {
    await setCurrency('KWD');
    const created = await placeOrder('cash_on_pickup').expect(201);
    const orderId = body<{ order: IdRow }>(created).order.id;
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/payment-link`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    // A link minted before the block shipped.
    await db.execute(
      `UPDATE \`order\` SET paymentLinkToken = ?, paymentLinkExpiresAt = NOW() + INTERVAL 1 DAY WHERE id = ?`,
      [`old-link-${runId}`, orderId],
    );
    const calls = stripe.calls.length;
    await request(app.getHttpServer())
      .get(`/pay/old-link-${runId}`)
      .expect(409);
    expect(stripe.calls).toHaveLength(calls);
  });

  it('sending an invoice for a KWD draft order is refused (400) and leaves the draft open with no order behind', async () => {
    await setCurrency('KWD');
    const draft = await request(app.getHttpServer())
      .post('/shop/draft-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        outletId,
        customerName: 'Phone Customer',
        customerPhone: '0501119999',
        customerAddress: 'Pickup',
        orderType: 'pickup',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    const draftId = body<IdRow>(draft).id;
    const before = await orderCount();
    await request(app.getHttpServer())
      .post(`/shop/draft-orders/${draftId}/send-invoice`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(await orderCount()).toBe(before);
    const after = await request(app.getHttpServer())
      .get(`/shop/draft-orders/${draftId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<{ status: string }>(after).status).toBe('OPEN');
  });

  it('an AED order on a shop later switched to KWD can still take a card link (the ORDER currency decides)', async () => {
    await setCurrency('AED');
    const created = await placeOrder('cash_on_pickup').expect(201);
    const orderId = body<{ order: IdRow }>(created).order.id;
    const link = await request(app.getHttpServer())
      .post(`/orders/${orderId}/payment-link`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await setCurrency('KWD');
    const calls = stripe.calls.length;
    await request(app.getHttpServer())
      .get(`/pay/${body<{ token: string }>(link).token}`)
      .expect(200);
    expect(stripe.calls).toHaveLength(calls + 1);
    expect(stripe.calls[calls].currency).toBe('AED');
  });
});
