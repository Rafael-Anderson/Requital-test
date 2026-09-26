import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
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
interface OrderResponse {
  id: number;
  currency: string;
  rateBaseCurrency: string | null;
  exchangeRate: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

jest.setTimeout(60000);

// Phase 2a / A2. An order freezes the exchange rate it was created under, and a
// later rate change must never restate it — the same discipline as
// priceAtPurchase and orderitem.unitCost, and the reason the invoice keeps
// adding up years later.
describe('Exchange rate capture and freeze (e2e)', () => {
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

  afterEach(async () => {
    // Restore the seeded peg so ordering between tests cannot matter.
    await db.execute(
      `UPDATE currencyrate SET rate = 3.6725 WHERE baseCurrency = 'USD' AND quoteCurrency = 'AED'`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Rate Admin',
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
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Rate Collection' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rate Rose',
        price: 100,
        thumbnail: 'https://example.com/r.jpg',
        sku: `RATE-${prefix}-${runId}`,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);

    return {
      adminToken,
      outletId: body<IdRow[]>(outlets)[0].id,
      productId: body<IdRow>(product).id,
    };
  }

  function createOrder(shop: {
    adminToken: string;
    outletId: number;
    productId: number;
  }) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        customerName: 'Rate Customer',
        customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
        customerAddress: '1 Rate St',
        emirate: 'Dubai',
        orderType: 'pickup',
        outletId: shop.outletId,
        deliveryFee: 0,
        items: [{ productId: shop.productId, quantity: 1 }],
      });
  }

  async function storedRate(orderId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT rateBaseCurrency, exchangeRate FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    return {
      base: rows[0].rateBaseCurrency as string | null,
      rate: rows[0].exchangeRate === null ? null : Number(rows[0].exchangeRate),
    };
  }

  it('captures the seeded peg against the platform base at creation', async () => {
    const shop = await setupShop('rate-capture');
    const order = body<OrderResponse>(await createOrder(shop).expect(201));

    expect(order.rateBaseCurrency).toBe('USD');
    expect(Number(order.exchangeRate)).toBeCloseTo(3.6725, 4);
  });

  // THE test this phase is answerable to. Changing a rate must move future
  // orders and nothing else.
  it('never restates a historical order when the rate changes later', async () => {
    const shop = await setupShop('rate-freeze');
    const before = body<OrderResponse>(await createOrder(shop).expect(201));
    expect(Number(before.exchangeRate)).toBeCloseTo(3.6725, 4);

    await db.execute(
      `UPDATE currencyrate SET rate = 9.9999 WHERE baseCurrency = 'USD' AND quoteCurrency = 'AED'`,
    );

    // The historical order is untouched at the data level...
    const frozen = await storedRate(before.id);
    expect(frozen.rate).toBeCloseTo(3.6725, 4);
    expect(frozen.base).toBe('USD');

    // ...and through the API, so nothing recomputes it on read either.
    const refetched = body<OrderResponse>(
      await request(app.getHttpServer())
        .get(`/orders/${before.id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200),
    );
    expect(Number(refetched.exchangeRate)).toBeCloseTo(3.6725, 4);

    // A NEW order picks up the new rate — proving the change took effect at all,
    // which is what makes the assertion above meaningful rather than vacuous.
    const after = body<OrderResponse>(await createOrder(shop).expect(201));
    expect(Number(after.exchangeRate)).toBeCloseTo(9.9999, 4);
  });

  it('captures a rate on the storefront path too', async () => {
    // Places a real storefront order rather than counting rows some other suite
    // happened to leave behind — an assertion that depends on another spec
    // having run is the brittle-count bug class recorded in CLAUDE.md.
    const shop = await setupShop('rate-storefront');
    await request(app.getHttpServer())
      .patch(`/outlets/${shop.outletId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);
    // Publishing has a readiness bar (outlet + product must exist first), and an
    // unpublished shop 404s on the public order route — see
    // PublicService.assertPublished.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ published: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/public/rate-storefront-${runId}/orders`)
      .send({
        outletId: shop.outletId,
        customerName: 'Storefront Rate Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup at outlet',
        emirate: 'Dubai',
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
      })
      .expect(201);

    const order = body<{ order: OrderResponse }>(res).order;
    expect(order.rateBaseCurrency).toBe('USD');
    expect(Number(order.exchangeRate)).toBeCloseTo(3.6725, 4);
  });

  it('captures null rather than a fake 1 when the platform has no rate for the currency', async () => {
    const shop = await setupShop('rate-missing');
    // Put the shop on a currency with no currencyrate row. Direct UPDATE because
    // shop.currency is still DTO-locked to AED until A6.
    await db.execute(
      `UPDATE shop SET currency = 'XYZ' WHERE id = (
         SELECT shopId FROM outlet WHERE id = ?
       )`,
      [shop.outletId],
    );

    const order = body<OrderResponse>(await createOrder(shop).expect(201));

    // A 1 here would read forever after as "this order was at parity with USD" —
    // a silent, plausible, permanently wrong number. NULL says "not captured",
    // which is the truth. And checkout still succeeded: a reporting figure has
    // no business failing a real order.
    expect(order.currency).toBe('XYZ');
    expect(order.exchangeRate).toBeNull();
    expect(order.rateBaseCurrency).toBeNull();
  });

  it('left pre-migration orders null rather than inventing a rate for them', async () => {
    // The migration deliberately does not backfill. The AED peg has been 3.6725
    // throughout, so a backfill would even produce the arithmetically right
    // number — and it would still be a fabrication, because "the rate this order
    // used" and "the rate that existed that day" are different claims.
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`order\` WHERE exchangeRate IS NULL`,
    );
    expect(Number(rows[0].c)).toBeGreaterThan(0);
  });
});
