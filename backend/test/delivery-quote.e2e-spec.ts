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
import { PublicController } from '../src/public/public.controller';
import { minorUnitFactor } from '../src/common/currency-minor-units';
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
interface Quote {
  status: 'quoted' | 'pickup_free' | 'needs_address' | 'unavailable';
  reason: string | null;
  zone: string | null;
  currency: string;
  subtotal: string | null;
  discountAmount: string | null;
  taxAmount: string | null;
  deliveryFee: string | null;
  total: string | null;
}
interface OrderResponse {
  order: { id: number; total: string; deliveryFee: string };
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(120000);

class CapturingStripe implements PaymentProvider {
  readonly name = 'stripe';
  readonly calls: CreateCheckoutSessionParams[] = [];
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    this.calls.push(params);
    return Promise.resolve({
      checkoutUrl: 'https://stub.example/checkout',
      providerReference: `stub_${this.calls.length}`,
    });
  }
  parseWebhookEvent() {
    return null;
  }
}

const LAT = 25.2048;
const LON = 55.2708;

// The delivery-fee quote must be the number the order is charged. Each scenario
// quotes, then places the real order with the same inputs and compares three
// things: the quoted total, the stored order.total and the amount handed to the
// payment gateway.
describe('Delivery fee quote equals the charge (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const stripe = new CapturingStripe();
  const runId = Date.now();

  interface TestShop {
    slug: string;
    adminToken: string;
    outletId: number;
    productId: number;
    shopId: number;
    regionId: number;
    regionName: string;
  }
  let aed: TestShop;
  let kwd: TestShop;

  async function setupShop(
    prefix: string,
    opts: {
      countryCode: string;
      currency: string;
      price: number;
      zoneFee: number;
      defaultFee: number;
    },
  ): Promise<TestShop> {
    const slug = `${prefix}-${runId}`;
    const http = app.getHttpServer();
    const signup = await request(http)
      .post('/auth/signup')
      .send({
        name: 'Quote Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      http,
      body<AuthResponse>(signup).devVerificationLink,
    );
    const auth = { Authorization: `Bearer ${adminToken}` };

    const outlets = await request(http).get('/outlets').set(auth).expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(http)
      .patch(`/outlets/${outletId}`)
      .set(auth)
      .send({
        active: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        latitude: LAT,
        longitude: LON,
        deliveryRadiusKm: 5,
      })
      .expect(200);
    await request(http)
      .patch('/shop')
      .set(auth)
      .send({
        currency: opts.currency,
        taxRate: 5,
        taxInclusive: false,
        defaultDeliveryFee: opts.defaultFee,
      })
      .expect(200);
    await db.execute(`UPDATE shop SET countryCode = ? WHERE subdomain = ?`, [
      opts.countryCode,
      slug,
    ]);
    const collection = await request(http)
      .post('/collections')
      .set(auth)
      .send({ name: 'Quote Goods' })
      .expect(201);
    const product = await request(http)
      .post('/products')
      .set(auth)
      .send({
        name: 'Quote Bouquet',
        price: opts.price,
        thumbnail: 'https://example.com/q.jpg',
        sku: `Q-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    await request(http)
      .patch('/shop')
      .set(auth)
      .send({ published: true })
      .expect(200);

    const shopRow = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    const region = await db.query<RowDataPacket[]>(
      `SELECT id, nameEn FROM region WHERE countryCode = ? ORDER BY sortOrder LIMIT 1`,
      [opts.countryCode],
    );
    // A zone named after the region: matched by the legacy name step, so this
    // shop's fee is the ZONE fee, distinct from its default fee.
    await db.execute(
      `INSERT INTO deliveryzone (outletId, name, fee, minOrderAmount, isActive)
       VALUES (?, ?, ?, 0, 1)`,
      [outletId, region[0].nameEn as string, opts.zoneFee],
    );
    return {
      slug,
      adminToken,
      outletId,
      productId: body<IdRow>(product).id,
      shopId: shopRow[0].id as number,
      regionId: region[0].id as number,
      regionName: region[0].nameEn as string,
    };
  }

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

    aed = await setupShop('dq-aed', {
      countryCode: 'AE',
      currency: 'AED',
      price: 100,
      zoneFee: 30,
      defaultFee: 15,
    });
    kwd = await setupShop('dq-kwd', {
      countryCode: 'KW',
      currency: 'KWD',
      price: 10.505,
      zoneFee: 1.505,
      defaultFee: 2,
    });
  });

  afterAll(async () => {
    await db.execute(
      `UPDATE \`order\` o JOIN shop s ON s.id = o.shopId
          SET o.paymentSessionId = NULL, o.paymentSessionGateway = NULL
        WHERE s.subdomain LIKE ?`,
      [`dq-%-${runId}`],
    );
    await app.close();
  });

  const NEAR = { latitude: LAT + 0.01, longitude: LON };

  function quote(shop: TestShop, over: Record<string, unknown> = {}, qty = 1) {
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/delivery-quote`)
      .send({
        outletId: shop.outletId,
        orderType: 'delivery',
        regionId: shop.regionId,
        ...NEAR,
        items: [{ productId: shop.productId, quantity: qty }],
        ...over,
      });
  }
  function order(shop: TestShop, over: Record<string, unknown> = {}, qty = 1) {
    const pickup = over.orderType === 'pickup';
    return request(app.getHttpServer())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'delivery',
        paymentMethod: pickup ? 'card_online' : 'card_online',
        customerName: 'Quote Customer',
        customerPhone: '0501234567',
        customerAddress: 'Somewhere 1',
        regionId: shop.regionId,
        ...NEAR,
        items: [{ productId: shop.productId, quantity: qty }],
        ...over,
      });
  }

  // quote -> order -> gateway, with the same inputs; returns the three totals.
  async function charged(
    shop: TestShop,
    over: Record<string, unknown> = {},
    qty = 1,
  ) {
    const q = body<Quote>(await quote(shop, over, qty).expect(201));
    const before = stripe.calls.length;
    const res = await order(shop, over, qty).expect(201);
    expect(stripe.calls.length).toBe(before + 1);
    const call = stripe.calls[before];
    return {
      quote: q,
      orderTotal: body<OrderResponse>(res).order.total,
      orderFee: body<OrderResponse>(res).order.deliveryFee,
      gatewayAmount: call.amount,
      currency: call.currency,
    };
  }

  it('delivery: quote total == order.total == gateway amount, fee from the matched zone', async () => {
    const r = await charged(aed);
    expect(r.quote.status).toBe('quoted');
    expect(r.quote.zone).toBe(aed.regionName);
    expect(r.quote.deliveryFee).toBe('30');
    // 100 + 5% tax + 30 delivery
    expect(r.quote.total).toBe('135');
    expect(Number(r.orderTotal)).toBe(135);
    expect(Number(r.orderFee)).toBe(30);
    expect(r.gatewayAmount).toBe(135);
  });

  it('pickup: free, and equal to the order and the gateway', async () => {
    const over = {
      orderType: 'pickup',
      regionId: undefined,
      latitude: undefined,
      longitude: undefined,
    };
    const r = await charged(aed, over);
    expect(r.quote.status).toBe('pickup_free');
    expect(r.quote.deliveryFee).toBe('0');
    expect(r.quote.total).toBe('105');
    expect(Number(r.orderTotal)).toBe(105);
    expect(r.gatewayAmount).toBe(105);
  });

  it('discount code: the quote applies it with the order eligibility and agrees to the fils', async () => {
    const code = `DQ${runId % 1000000}`;
    await request(app.getHttpServer())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${aed.adminToken}`)
      .send({ code, type: 'PERCENTAGE', value: 10 })
      .expect(201);
    const r = await charged(aed, { discountCode: code });
    expect(r.quote.discountAmount).toBe('10');
    // (100 - 10) + 5% of 90 + 30
    expect(r.quote.total).toBe('124.5');
    expect(Number(r.orderTotal)).toBe(124.5);
    expect(r.gatewayAmount).toBe(124.5);
  });

  it('an invalid discount code is unavailable with the message the order would reject with', async () => {
    const q = body<Quote>(
      await quote(aed, { discountCode: 'NOPE-NOPE' }).expect(201),
    );
    expect(q.status).toBe('unavailable');
    const o = await order(aed, { discountCode: 'NOPE-NOPE' }).expect(400);
    expect(q.reason).toBe((o.body as { message: string }).message);
  });

  it('KWD (3 decimals): exact minor units agree across quote, order and gateway', async () => {
    const r = await charged(kwd, {}, 3);
    expect(r.currency).toBe('KWD');
    expect(r.quote.deliveryFee).toBe('1.505');
    // 3 x 10.505 = 31.515; 5% tax = 1.57575; + 1.505 = 34.59575 -> 34.596 KWD
    expect(r.quote.total).toBe('34.596');
    expect(r.orderTotal).toBe('34.596');
    expect(Math.round(r.gatewayAmount * minorUnitFactor('KWD'))).toBe(34596);
    expect(Math.round(Number(r.quote.total) * 1000)).toBe(34596);
  });

  it('needs_address before any address or pin: never a fee, never a guess', async () => {
    const q = body<Quote>(
      await quote(aed, {
        regionId: undefined,
        latitude: undefined,
        longitude: undefined,
      }).expect(201),
    );
    expect(q.status).toBe('needs_address');
    expect(q.deliveryFee).toBeNull();
    expect(q.total).toBeNull();
  });

  it('needs_address when the outlet needs a pin to prove delivery range', async () => {
    const q = body<Quote>(
      await quote(aed, { latitude: undefined, longitude: undefined }).expect(
        201,
      ),
    );
    expect(q.status).toBe('needs_address');
    expect(q.reason).toMatch(/location is required/i);
  });

  it('unavailable outside the radius, with the same message the order is rejected with', async () => {
    const far = { latitude: 24.4539, longitude: 54.3773 };
    const q = body<Quote>(await quote(aed, far).expect(201));
    expect(q.status).toBe('unavailable');
    expect(q.total).toBeNull();
    const o = await order(aed, far).expect(400);
    expect(q.reason).toBe((o.body as { message: string }).message);
  });

  it('unavailable when the outlet does not offer delivery', async () => {
    await db.execute(`UPDATE outlet SET deliveryEnabled = 0 WHERE id = ?`, [
      aed.outletId,
    ]);
    try {
      const q = body<Quote>(await quote(aed).expect(201));
      expect(q.status).toBe('unavailable');
      expect(q.reason).toBe('This outlet does not offer delivery');
    } finally {
      await db.execute(`UPDATE outlet SET deliveryEnabled = 1 WHERE id = ?`, [
        aed.outletId,
      ]);
    }
  });

  it('writes nothing: no order, no customer, no redemption', async () => {
    const count = async () =>
      (
        await db.query<RowDataPacket[]>(
          `SELECT (SELECT COUNT(*) FROM \`order\` WHERE shopId = ?) o,
                  (SELECT COUNT(*) FROM customer WHERE shopId = ?) c`,
          [aed.shopId, aed.shopId],
        )
      )[0];
    const before = await count();
    await quote(aed).expect(201);
    await quote(aed, { orderType: 'pickup' }).expect(201);
    expect(await count()).toEqual(before);
  });

  describe('tenant isolation and validation', () => {
    it("another shop's outlet is refused, not quoted", async () => {
      await quote(aed, { outletId: kwd.outletId }).expect(400);
    });
    it("another shop's product is refused", async () => {
      const res = await quote(aed, {
        items: [{ productId: kwd.productId, quantity: 1 }],
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
    it("another country's region id is unavailable, same message as an unknown one", async () => {
      const a = body<Quote>(
        await quote(aed, { regionId: kwd.regionId }).expect(201),
      );
      const b = body<Quote>(
        await quote(aed, { regionId: 99999999 }).expect(201),
      );
      expect(a.status).toBe('unavailable');
      expect(a.reason).toBe(b.reason);
    });
    it('an unknown shop slug is 404', async () => {
      await request(app.getHttpServer())
        .post(`/public/no-such-shop-${runId}/delivery-quote`)
        .send({
          outletId: aed.outletId,
          orderType: 'pickup',
          items: [{ productId: aed.productId, quantity: 1 }],
        })
        .expect(404);
    });
    it('rejects customer fields (no PII accepted) and oversized carts', async () => {
      await quote(aed, { customerPhone: '0501234567' }).expect(400);
      const items = Array.from({ length: 101 }, () => ({
        productId: aed.productId,
        quantity: 1,
      }));
      await quote(aed, { items }).expect(400);
      await quote(aed, { items: [] }).expect(400);
    });
    it('is throttled by its own named per-IP limit', () => {
      const proto = PublicController.prototype as unknown as Record<
        string,
        object
      >;
      const limit = Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        proto.quoteDelivery,
      ) as number;
      expect(typeof limit).toBe('number');
      expect(limit).toBeLessThanOrEqual(60);
    });
  });
});
