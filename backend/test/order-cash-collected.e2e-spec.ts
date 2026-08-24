import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
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
interface CreateOrderResponseBody {
  order: { id: number };
}
interface OrderDetailBody {
  id: number;
  status: string;
  paymentMethod: string | null;
  cashCollectedAt: string | null;
  cashCollectedBy: number | null;
  cashCollectedByName: string | null;
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

// The completion gate (OrdersService.updateStatus's pre-check) and the
// POST /orders/:id/collect-cash endpoint that clears it — see that method's
// own comment for why this is a plain pre-check, not folded into the CAS
// UPDATE. Only storefront checkout (POST /public/:shopSlug/orders) ever
// sets order.paymentMethod — admin-created orders (POST /orders) never do
// — so every order here is created via the public endpoint, same as
// storefront-checkout.e2e-spec.ts's own setup.
describe('Cash-on-delivery completion gate (e2e)', () => {
  let app: INestApplication<App>;
  const runId = Date.now();
  const shopSlug = `cod-gate-test-${runId}`;

  let adminToken: string;
  let outletId: number;
  let productId: number;

  const OUTLET_LAT = 25.2048;
  const OUTLET_LON = 55.2708;

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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'COD Gate Test Admin',
        email: `cod-gate-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'COD Gate Test Shop',
        subdomain: shopSlug,
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
    outletId = body<OutletRow[]>(outlets)[0].id;

    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        active: true,
        emirate: 'Dubai',
        deliveryEnabled: true,
        pickupEnabled: true,
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
        name: 'COD Gate Product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `CODGATE-${runId}`,
        trackInventory: true,
        collectionIds: [collectionId],
      })
      .expect(201);
    productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId, adjustments: [{ productId, delta: 100 }] })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      outletId,
      customerName: 'COD Customer',
      customerPhone: '0501234567',
      customerAddress: '1 Sheikh Zayed Rd',
      emirate: 'Dubai',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }

  async function createOrder(
    paymentMethod: string,
    orderType: 'delivery' | 'pickup' = 'delivery',
  ) {
    const res = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send(
        basePayload({
          orderType,
          paymentMethod,
          ...(orderType === 'delivery'
            ? { latitude: OUTLET_LAT, longitude: OUTLET_LON }
            : {}),
        }),
      )
      .expect(201);
    return body<CreateOrderResponseBody>(res).order.id;
  }

  async function advanceTo(orderId: number, status: string, expectStatus = 200) {
    return request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status })
      .expect(expectStatus);
  }

  it('blocks a COD order from reaching delivered until cash is marked collected, then allows it', async () => {
    const orderId = await createOrder('cash_on_delivery');
    await advanceTo(orderId, 'confirmed');
    await advanceTo(orderId, 'preparing');
    await advanceTo(orderId, 'out_for_delivery');

    const blocked = await advanceTo(orderId, 'delivered', 400);
    expect(messageContains(blocked, 'cash')).toBe(true);

    const collectRes = await request(app.getHttpServer())
      .post(`/orders/${orderId}/collect-cash`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const collected = body<OrderDetailBody>(collectRes);
    expect(collected.cashCollectedAt).not.toBeNull();
    expect(collected.cashCollectedByName).toBeTruthy();

    const delivered = await advanceTo(orderId, 'delivered');
    expect(body<OrderDetailBody>(delivered).status).toBe('delivered');
  });

  it('collect-cash is idempotent — a second call does not error or move the timestamp', async () => {
    const orderId = await createOrder('cash_on_delivery');
    const first = await request(app.getHttpServer())
      .post(`/orders/${orderId}/collect-cash`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const firstTimestamp = body<OrderDetailBody>(first).cashCollectedAt;

    const second = await request(app.getHttpServer())
      .post(`/orders/${orderId}/collect-cash`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(body<OrderDetailBody>(second).cashCollectedAt).toBe(firstTimestamp);
  });

  // cash_on_pickup is deliberately excluded from the gate's scope — the
  // gate is literally "cash_on_delivery" only, per the feature spec (see
  // OrdersService.updateStatus's own comment). This also doubles as the
  // regression test for that scope decision.
  it('collect-cash rejects a cash_on_pickup order (COD-only scope)', async () => {
    const orderId = await createOrder('cash_on_pickup', 'pickup');
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/collect-cash`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(messageContains(res, 'cash')).toBe(true);
  });

  it('a cash_on_pickup order reaches delivered with no gate at all (COD-only scope)', async () => {
    const orderId = await createOrder('cash_on_pickup', 'pickup');
    await advanceTo(orderId, 'confirmed');
    await advanceTo(orderId, 'preparing');
    await advanceTo(orderId, 'out_for_delivery');
    const delivered = await advanceTo(orderId, 'delivered');
    expect(body<OrderDetailBody>(delivered).status).toBe('delivered');
  });

  it("cross-shop collect-cash 404s rather than leaking another shop's order", async () => {
    const orderId = await createOrder('cash_on_delivery');

    const otherSlug = `cod-gate-other-${runId}`;
    const otherSignup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Other Shop Admin',
        email: `cod-gate-other-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'Other Shop',
        subdomain: otherSlug,
      })
      .expect(201);
    const otherToken = body<AuthResponse>(otherSignup).accessToken;

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/collect-cash`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });
});
