import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type {
  ShopRow,
  CustomerRow,
  OrderRow,
  DiscountRow as DiscountDbRow,
} from '../src/db/types';
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
interface DiscountRow {
  id: number;
  code: string;
  type: string;
  value: string | null;
  timesUsed: number;
  usageLimit: number | null;
  active: boolean;
}
interface ValidateResult {
  valid: boolean;
  reason?: string;
  message?: string;
  discountId?: number;
  code?: string;
  discountAmount?: number;
  freeShipping?: boolean;
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

const OUTLET_LAT = 25.2048;
const OUTLET_LON = 55.2708;

describe('Discounts (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  beforeAll(async () => {
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
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function getDiscountById(id: number): Promise<DiscountDbRow> {
    const rows = await db.query<(DiscountDbRow & RowDataPacket)[]>(
      `SELECT * FROM discount WHERE id = ?`,
      [id],
    );
    if (!rows[0]) throw new Error('discount not found');
    return rows[0];
  }

  async function getShopBySubdomain(subdomain: string): Promise<ShopRow | undefined> {
    const rows = await db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ?`,
      [subdomain],
    );
    return rows[0];
  }

  async function getOrderById(id: number): Promise<OrderRow | undefined> {
    const rows = await db.query<(OrderRow & RowDataPacket)[]>(
      `SELECT * FROM \`order\` WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Discounts Test Admin',
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
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        active: true,
        emirate: 'Dubai',
        deliveryEnabled: true,
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
        deliveryRadiusKm: 5,
      })
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
        name: `Widget ${Math.random()}`,
        price: 100,
        thumbnail: 'https://example.com/widget.jpg',
        sku: `WIDGET-${slug}-${Math.random().toString(36).slice(2, 8)}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { adminToken, outletId, collectionId, productId, slug };
  }

  async function createDiscount(
    adminToken: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/shop/discounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `CODE${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        type: 'PERCENTAGE',
        value: 10,
        ...overrides,
      })
      .expect(201);
    return body<DiscountRow>(res);
  }

  function orderPayload(
    outletId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      outletId,
      orderType: 'delivery',
      paymentMethod: 'cash_on_delivery',
      customerName: 'Discount Customer',
      customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
      customerAddress: '1 Main St',
      emirate: 'Dubai',
      latitude: OUTLET_LAT,
      longitude: OUTLET_LON,
      ...overrides,
    };
  }

  describe('CRUD + validation', () => {
    it('creates a PERCENTAGE discount and rejects FREE_SHIPPING with a value', async () => {
      const { adminToken } = await setupShop('crud');
      await createDiscount(adminToken, { type: 'PERCENTAGE', value: 15 });
      const res = await request(app.getHttpServer())
        .post('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'FREESHIP1', type: 'FREE_SHIPPING', value: 5 })
        .expect(400);
      expect(messageContains(res, 'FREE_SHIPPING')).toBe(true);
    });

    it('rejects PERCENTAGE/FIXED_AMOUNT without a value', async () => {
      const { adminToken } = await setupShop('crud-novalue');
      const res = await request(app.getHttpServer())
        .post('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'NOVALUE1', type: 'FIXED_AMOUNT' })
        .expect(400);
      expect(messageContains(res, 'value is required')).toBe(true);
    });

    it('normalizes code to uppercase and rejects a duplicate code (case-insensitively)', async () => {
      const { adminToken } = await setupShop('dupe');
      await request(app.getHttpServer())
        .post('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'save10', type: 'PERCENTAGE', value: 10 })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'SAVE10', type: 'FIXED_AMOUNT', value: 5 })
        .expect(409);
      expect(messageContains(res, 'already exists')).toBe(true);
    });

    it('lists, updates, and deletes a discount', async () => {
      const { adminToken } = await setupShop('crud-full');
      const discount = await createDiscount(adminToken);
      const list = await request(app.getHttpServer())
        .get('/shop/discounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<DiscountRow[]>(list).some((d) => d.id === discount.id)).toBe(
        true,
      );

      await request(app.getHttpServer())
        .patch(`/shop/discounts/${discount.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/shop/discounts/${discount.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/shop/discounts/${discount.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('validate — specific rejection reasons', () => {
    it('not_found for an unknown code', async () => {
      const { adminToken } = await setupShop('reason-notfound');
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'NOPE', cartSubtotal: 100 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'not_found',
      });
    });

    it('inactive when active is false', async () => {
      const { adminToken } = await setupShop('reason-inactive');
      const d = await createDiscount(adminToken, { active: false });
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'inactive',
      });
    });

    it('not_started before startsAt', async () => {
      const { adminToken } = await setupShop('reason-notstarted');
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const d = await createDiscount(adminToken, { startsAt: future });
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'not_started',
      });
    });

    it('expired after endsAt', async () => {
      const { adminToken } = await setupShop('reason-expired');
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const d = await createDiscount(adminToken, { endsAt: past });
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'expired',
      });
    });

    it('min_purchase_not_met below the threshold', async () => {
      const { adminToken } = await setupShop('reason-minpurchase');
      const d = await createDiscount(adminToken, { minPurchaseAmount: 200 });
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 50 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'min_purchase_not_met',
      });

      const ok = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 250 })
        .expect(201);
      expect(body<ValidateResult>(ok).valid).toBe(true);
    });

    it('usage_limit_reached once timesUsed hits the cap', async () => {
      const { adminToken } = await setupShop('reason-usagelimit');
      const d = await createDiscount(adminToken, { usageLimit: 1 });
      await db.execute(`UPDATE discount SET timesUsed = ? WHERE id = ?`, [
        1,
        d.id,
      ]);
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'usage_limit_reached',
      });
    });

    it('per_customer_limit_reached once a customer has redeemed the cap', async () => {
      const { adminToken, outletId, collectionId, slug } =
        await setupShop('reason-percustomer');
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Cap Item',
          price: 40,
          thumbnail: 'https://example.com/c.jpg',
          sku: `CAP-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(productRes).id;
      const d = await createDiscount(adminToken, { usageLimitPerCustomer: 1 });
      const phone = `05${Math.floor(Math.random() * 100000000)}`;

      await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          orderPayload(outletId, {
            customerPhone: phone,
            discountCode: d.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);

      const shop = await getShopBySubdomain(slug);
      const customerRows = await db.query<(CustomerRow & RowDataPacket)[]>(
        `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
        [shop!.id, phone],
      );
      const customer = customerRows[0];
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100, customerId: customer!.id })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'per_customer_limit_reached',
      });
    });

    it('not_eligible when appliesTo SPECIFIC_PRODUCTS excludes the cart', async () => {
      const { adminToken, productId } = await setupShop('reason-noteligible');
      const d = await createDiscount(adminToken, {
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [productId],
      });
      const res = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100, productIds: [999999] })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'not_eligible',
      });

      const ok = await request(app.getHttpServer())
        .post('/shop/discounts/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: d.code, cartSubtotal: 100, productIds: [productId] })
        .expect(201);
      expect(body<ValidateResult>(ok).valid).toBe(true);
    });

    it('storefront-facing validate is case-insensitive and reachable without auth', async () => {
      const { adminToken, slug } = await setupShop('reason-public');
      const d = await createDiscount(adminToken, {
        code: 'SAVE20',
        type: 'PERCENTAGE',
        value: 20,
      });
      const res = await request(app.getHttpServer())
        .post(`/public/${slug}/discounts/validate`)
        .send({ code: 'save20', cartSubtotal: 100 })
        .expect(201);
      const result = body<ValidateResult>(res);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(20);
      void d;
    });
  });

  describe('order integration — snapshot fields and totals', () => {
    it('PERCENTAGE discount reduces the order total and snapshots discountCode/discountAmount/discountId', async () => {
      const { adminToken, outletId, collectionId, slug } =
        await setupShop('order-percent');
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Percent Item',
          price: 100,
          thumbnail: 'https://example.com/p.jpg',
          sku: `PCT-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(productRes).id;
      const d = await createDiscount(adminToken, {
        type: 'PERCENTAGE',
        value: 10,
      });

      const res = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          orderPayload(outletId, {
            discountCode: d.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);
      const order = body<{ order: { id: number; total: string } }>(res).order;
      const dbOrder = await getOrderById(order.id);
      expect(dbOrder?.discountId).toBe(d.id);
      expect(dbOrder?.discountCode).toBe(d.code);
      expect(Number(dbOrder?.discountAmount)).toBe(10);
      // subtotal 100 - discount 10 = 90, plus whatever delivery fee applies (no tax configured).
      expect(Number(dbOrder?.total)).toBeLessThan(100);

      const updatedDiscount = await getDiscountById(d.id);
      expect(updatedDiscount?.timesUsed).toBe(1);
    });

    it('FIXED_AMOUNT and FREE_SHIPPING apply correctly, and an invalid code rejects checkout', async () => {
      const { adminToken, outletId, collectionId, slug } =
        await setupShop('order-fixed');
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Fixed Item',
          price: 100,
          thumbnail: 'https://example.com/i.jpg',
          sku: `FIX-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(productRes).id;

      const fixed = await createDiscount(adminToken, {
        type: 'FIXED_AMOUNT',
        value: 30,
      });
      const orderRes = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          orderPayload(outletId, {
            discountCode: fixed.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);
      const order = body<{
        order: { id: number; total: string; deliveryFee: string | null };
      }>(orderRes).order;
      const dbOrder = await getOrderById(order.id);
      expect(Number(dbOrder?.discountAmount)).toBe(30);
      expect(dbOrder?.discountCode).toBe(fixed.code);

      const freeShip = await createDiscount(adminToken, {
        type: 'FREE_SHIPPING',
        value: undefined,
      });
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultDeliveryFee: 25 })
        .expect(200);
      const freeShipRes = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          orderPayload(outletId, {
            discountCode: freeShip.code,
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(201);
      const freeShipOrder = body<{ order: { id: number } }>(freeShipRes).order;
      const dbFreeShip = await getOrderById(freeShipOrder.id);
      expect(Number(dbFreeShip?.deliveryFee)).toBe(0);

      const badRes = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          orderPayload(outletId, {
            discountCode: 'NOT-A-REAL-CODE',
            items: [{ productId, quantity: 1 }],
          }),
        )
        .expect(400);
      expect(messageContains(badRes, 'not valid')).toBe(true);
    });
  });

  describe('race condition — usageLimit enforced under concurrency', () => {
    it('N concurrent orders against usageLimit 1: exactly one succeeds', async () => {
      const { adminToken, outletId, collectionId, slug } =
        await setupShop('race');
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Race Item',
          price: 50,
          thumbnail: 'https://example.com/r.jpg',
          sku: `RACE-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(productRes).id;
      const d = await createDiscount(adminToken, { usageLimit: 1 });

      const CONCURRENCY = 8;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app.getHttpServer())
            .post(`/public/${slug}/orders`)
            .send(
              orderPayload(outletId, {
                discountCode: d.code,
                customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
                items: [{ productId, quantity: 1 }],
              }),
            ),
        ),
      );
      const succeeded = results.filter((r) => r.status === 201);
      const failed = results.filter((r) => r.status !== 201);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(CONCURRENCY - 1);

      const finalDiscount = await getDiscountById(d.id);
      expect(finalDiscount?.timesUsed).toBe(1);
      const redemptionRows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM discountredemption WHERE discountId = ?`,
        [d.id],
      );
      const redemptions = Number(redemptionRows[0].c);
      expect(redemptions).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it("a discount from shop A is invisible/uneditable from shop B, and validate 404s for it under B's slug", async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      const discountA = await createDiscount(shopA.adminToken);

      await request(app.getHttpServer())
        .get(`/shop/discounts/${discountA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/shop/discounts/${discountA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ active: false })
        .expect(404);

      const res = await request(app.getHttpServer())
        .post(`/public/${shopB.slug}/discounts/validate`)
        .send({ code: discountA.code, cartSubtotal: 100 })
        .expect(201);
      expect(body<ValidateResult>(res)).toMatchObject({
        valid: false,
        reason: 'not_found',
      });
    });
  });
});
