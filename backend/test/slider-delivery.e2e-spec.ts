import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import type { RowDataPacket } from 'mysql2/promise';
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
interface ExternalDelivery {
  status: string;
  provider: string;
  sliderOrderNumber: number | null;
  trackingUrl: string | null;
  driverName: string | null;
  driverPhone: string | null;
}
interface OrderDetailBody {
  id: number;
  cashCollectedAt: string | null;
  externaldelivery: ExternalDelivery | null;
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

// Every Slider call this test exercises goes through global.fetch (the
// provider uses the raw fetch API, no SDK — see slider-delivery.provider.ts)
// — mocked here for both the outbound Nominatim geocode
// (SliderDeliveryService.resolvePoints) and the outbound Slider API calls
// themselves, matching the same "mock global.fetch for an e2e spec" pattern
// payments-paypal.e2e-spec.ts already uses. `distanceKm` is mutable so a
// single test can flip it to exceed the bike cap.
let distanceKm = 5;
let sliderOrderCounter = 100;

function jsonRes(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('Slider delivery integration (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let jobsWorker: JobsWorkerService;
  const runId = Date.now();
  const shopSlug = `slider-test-${runId}`;

  let shopId: number;
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
    db = moduleFixture.get(DatabaseService);
    jobsWorker = moduleFixture.get(JobsWorkerService);

    global.fetch = jest.fn(
      // SliderDeliveryProvider/geocodeAddress always call fetch with a plain
      // string URL, never a Request/URL object — typed narrowly as `string`
      // rather than the full RequestInfo|URL union so `url` below doesn't
      // need a base-to-string-unsafe `String(input)`.
      (input: string, init?: RequestInit) => {
        const url = input;
        const method = init?.method ?? 'GET';
        if (url.includes('nominatim.openstreetmap.org')) {
          return jsonRes(200, [
            {
              lat: '25.10',
              lon: '55.20',
              display_name: 'Test Delivery Address',
            },
          ]) as unknown as Response;
        }
        if (url.includes('/deliveries/fare')) {
          return jsonRes(200, {
            distance_km: distanceKm,
            duration_minutes: 18,
            vehicles: [
              {
                vehicle_type: 'bike',
                delivery_fee: 12,
                is_available: true,
                unavailable_reason: null,
              },
              {
                vehicle_type: 'car',
                delivery_fee: 22,
                is_available: true,
                unavailable_reason: null,
              },
            ],
          }) as unknown as Response;
        }
        if (url.includes('/deliveries') && method === 'POST') {
          sliderOrderCounter += 1;
          return jsonRes(201, {
            order_number: sliderOrderCounter,
            status: 'searching_rider',
            fare: 12,
            currency: 'AED',
            distance_km: distanceKm,
            tracking_url: `https://track.slider-app.com/${sliderOrderCounter}`,
            created_at: new Date().toISOString(),
          }) as unknown as Response;
        }
        if (method === 'DELETE') {
          return jsonRes(204, undefined) as unknown as Response;
        }
        throw new Error(
          `Unhandled fetch in slider-delivery.e2e-spec: ${method} ${url}`,
        );
      },
    ) as unknown as typeof fetch;

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Slider Test Admin',
        email: `slider-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'Slider Test Shop',
        subdomain: shopSlug,
      })
      .expect(201);
    adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    shopId = body<{ shopId: number }>(me).shopId;

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
        deliveryRadiusKm: 20,
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
        name: 'Slider Test Product',
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `SLIDER-${runId}`,
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

    await request(app.getHttpServer())
      .patch('/slider-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        apiKey: 'sk_test_slider',
        accountId: 'acct_test',
        webhookToken: 'whsec_test_token',
        environment: 'sandbox',
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOrder(paymentMethod: string, priceOverride?: number) {
    if (priceOverride) {
      await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: priceOverride })
        .expect(200);
    }
    const res = await request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send({
        outletId,
        customerName: 'Slider Customer',
        customerPhone: '0501234567',
        customerAddress: '1 Sheikh Zayed Rd',
        emirate: 'Dubai',
        orderType: 'delivery',
        paymentMethod,
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    if (priceOverride) {
      await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 50 })
        .expect(200);
    }
    return body<CreateOrderResponseBody>(res).order.id;
  }

  async function latestJobId(type: string): Promise<number> {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT id FROM job WHERE shopId = ? AND type = ? ORDER BY id DESC LIMIT 1`,
      [shopId, type],
    );
    return rows[0].id as number;
  }

  it('quotes distance/duration/vehicles for an order', async () => {
    distanceKm = 5;
    const orderId = await createOrder('cash_on_delivery');
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery/quote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(res.body).toMatchObject({
      distanceKm: 5,
      durationMinutes: 18,
      vehicles: expect.arrayContaining([
        expect.objectContaining({ vehicleType: 'bike', deliveryFee: 12 }),
      ]),
    });
  });

  it('dispatches a delivery and reflects it on the order', async () => {
    distanceKm = 5;
    const orderId = await createOrder('cash_on_delivery');
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'bike' })
      .expect(201);
    const order = body<OrderDetailBody>(res);
    expect(order.externaldelivery).toMatchObject({
      provider: 'slider',
      status: 'searching_rider',
    });
    expect(order.externaldelivery?.sliderOrderNumber).toBeGreaterThan(0);

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<OrderDetailBody>(fetched).externaldelivery?.provider).toBe(
      'slider',
    );
  });

  it('rejects a bike dispatch over the 35km distance cap', async () => {
    distanceKm = 40;
    const orderId = await createOrder('cash_on_delivery');
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'bike' })
      .expect(400);
    expect(messageContains(res, '35km')).toBe(true);
    distanceKm = 5;
  });

  it('rejects dispatching a cash_on_delivery order over the AED 350 cap', async () => {
    distanceKm = 5;
    const orderId = await createOrder('cash_on_delivery', 400);
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(400);
    expect(messageContains(res, 'AED 350')).toBe(true);
  });

  it('rejects a scheduleAt under 30 minutes in the future', async () => {
    const orderId = await createOrder('cash_on_delivery');
    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleType: 'any',
        scheduleAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      .expect(400);
    expect(messageContains(res, '30 minutes')).toBe(true);
  });

  it('cancels a dispatched delivery', async () => {
    const orderId = await createOrder('cash_on_delivery');
    await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .delete(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<OrderDetailBody>(cancelled).externaldelivery?.status).toBe(
      'cancelled',
    );
  });

  it('the webhook is a 2xx even for an unknown order (no crash, no leak)', async () => {
    await request(app.getHttpServer())
      .post('/slider/webhook')
      .send({ order_number: 999999, order_id: 999999999, status: 'in_transit' })
      .expect(201);
  });

  it('a valid webhook token updates status and driver info via the job queue', async () => {
    const orderId = await createOrder('cash_on_delivery');
    const dispatched = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(201);
    const sliderOrderNumber =
      body<OrderDetailBody>(dispatched).externaldelivery!.sliderOrderNumber;

    await request(app.getHttpServer())
      .post('/slider/webhook')
      .set('x-slider-webhook-token', 'whsec_test_token')
      .send({
        order_number: sliderOrderNumber,
        order_id: orderId,
        status: 'in_transit',
        tracking_link: 'https://track.slider-app.com/updated',
        driver_info: {
          name: 'Ali Driver',
          phone_number: '+971500000009',
          latitude: 25.11,
          longitude: 55.21,
        },
        timestamp: Date.now(),
      })
      .expect(201);

    const jobId = await latestJobId('process_slider_webhook');
    expect(await jobsWorker.processJobById(jobId)).toBe(true);

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const delivery = body<OrderDetailBody>(fetched).externaldelivery!;
    expect(delivery.status).toBe('in_transit');
    expect(delivery.driverName).toBe('Ali Driver');
    expect(delivery.driverPhone).toBe('+971500000009');
    expect(delivery.trackingUrl).toBe('https://track.slider-app.com/updated');
  });

  it('an invalid webhook token is silently dropped — no status update', async () => {
    const orderId = await createOrder('cash_on_delivery');
    const dispatched = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(201);
    const sliderOrderNumber =
      body<OrderDetailBody>(dispatched).externaldelivery!.sliderOrderNumber;

    await request(app.getHttpServer())
      .post('/slider/webhook')
      .set('x-slider-webhook-token', 'wrong-token')
      .send({
        order_number: sliderOrderNumber,
        order_id: orderId,
        status: 'in_transit',
        timestamp: Date.now(),
      })
      .expect(201);

    const jobId = await latestJobId('process_slider_webhook');
    expect(await jobsWorker.processJobById(jobId)).toBe(true);

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // Still 'searching_rider' (the status set at dispatch) — the wrong-token
    // webhook never touched the row.
    expect(body<OrderDetailBody>(fetched).externaldelivery?.status).toBe(
      'searching_rider',
    );
  });

  it("a 'delivered' webhook on a cash_on_delivery order auto-marks cash collected", async () => {
    const orderId = await createOrder('cash_on_delivery', 100);
    const dispatched = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(201);
    expect(body<OrderDetailBody>(dispatched).cashCollectedAt).toBeNull();
    const sliderOrderNumber =
      body<OrderDetailBody>(dispatched).externaldelivery!.sliderOrderNumber;

    await request(app.getHttpServer())
      .post('/slider/webhook')
      .set('x-slider-webhook-token', 'whsec_test_token')
      .send({
        order_number: sliderOrderNumber,
        order_id: orderId,
        status: 'delivered',
        timestamp: Date.now(),
      })
      .expect(201);

    const jobId = await latestJobId('process_slider_webhook');
    expect(await jobsWorker.processJobById(jobId)).toBe(true);

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const orderDetail = body<OrderDetailBody>(fetched);
    expect(orderDetail.externaldelivery?.status).toBe('delivered');
    expect(orderDetail.cashCollectedAt).not.toBeNull();
  });

  it("cross-shop dispatch 404s rather than leaking another shop's order", async () => {
    const orderId = await createOrder('cash_on_delivery');

    const otherSlug = `slider-other-${runId}`;
    const otherSignup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Other Shop Admin',
        email: `slider-other-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'Other Slider Shop',
        subdomain: otherSlug,
      })
      .expect(201);
    const otherToken = body<AuthResponse>(otherSignup).accessToken;

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ vehicleType: 'any' })
      .expect(404);
  });
});
