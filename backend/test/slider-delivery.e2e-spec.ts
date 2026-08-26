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
import * as bcrypt from 'bcryptjs';
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

// Session-cookie migration (security audit finding #1) — platform-auth
// sessions are httpOnly cookies now, not bearer tokens. Same helpers as
// platform-admin.e2e-spec.ts; this file only needs the platform session
// once, to set the shop's sliderAccountId in beforeAll.
function extractCookies(res: Response): Record<string, string> {
  const lines = res.get('Set-Cookie') ?? [];
  const cookies: Record<string, string> = {};
  for (const line of lines) {
    const pair = line.split(';')[0];
    const idx = pair.indexOf('=');
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
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
    // Platform-level Slider credentials (env vars, not per-shop DB rows —
    // see the corrected credential model in CLAUDE.md / SliderSettingsService).
    process.env.SLIDER_API_KEY = 'sk_test_platform';
    process.env.SLIDER_ENVIRONMENT = 'sandbox';
    process.env.SLIDER_WEBHOOK_TOKEN = 'whsec_test_token';
    // PLATFORM_JWT_SECRET comes from .env — see platform-admin.e2e-spec.ts's
    // own comment for why setting it here would be too late.

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

    // Merchant-facing: enable Slider for this shop.
    await request(app.getHttpServer())
      .patch('/slider-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true })
      .expect(200);
    // Platform-admin-only: set this shop's Slider customer account id — a
    // merchant can't do this themselves (see PlatformAdminController). No
    // signup route exists for this tier (see PlatformAuthModule) — seed the
    // row directly, the same way scripts/seed-platform-admin.ts would.
    const platformPasswordHash = await bcrypt.hash('platform-password-123', 10);
    await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [
        `platform-admin-${runId}@test.com`,
        platformPasswordHash,
        'Platform Test Admin',
      ],
    );
    const platformLogin = await request(app.getHttpServer())
      .post('/platform-auth/login')
      .send({
        email: `platform-admin-${runId}@test.com`,
        password: 'platform-password-123',
      })
      .expect(201);
    const platformCookies = extractCookies(platformLogin);
    const platformCookieHeader = cookieHeader(platformCookies);
    const platformCsrfToken = platformCookies['req-platform-csrf'];

    await request(app.getHttpServer())
      .patch(`/platform-admin/shops/${shopId}/slider-account-id`)
      .set('Cookie', platformCookieHeader)
      .set('X-CSRF-Token', platformCsrfToken)
      .send({ accountId: 'acct_test' })
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

  // Used to prove a rejected-before-enqueue webhook genuinely never wrote a
  // job row, rather than writing one that later gets ignored.
  async function jobCount(type: string): Promise<number> {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM job WHERE shopId = ? AND type = ?`,
      [shopId, type],
    );
    return Number(rows[0].c);
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

  it('a correctly-authenticated webhook for an unknown order is still a 2xx (no crash, no leak)', async () => {
    await request(app.getHttpServer())
      .post('/slider/webhook')
      .set('x-slider-webhook-token', 'whsec_test_token')
      .send({ order_number: 999999, order_id: 999999999, status: 'in_transit' })
      .expect(201);
  });

  it('a webhook with no token at all is rejected with 401 before any DB work', async () => {
    const beforeCount = await jobCount('process_slider_webhook');
    await request(app.getHttpServer())
      .post('/slider/webhook')
      .send({ order_number: 999999, order_id: 999999999, status: 'in_transit' })
      .expect(401);
    // No job written — the whole point of moving the check ahead of the
    // enqueue. A real order id makes this a meaningful assertion (the old
    // code would have looked it up and enqueued before ever checking auth).
    expect(await jobCount('process_slider_webhook')).toBe(beforeCount);
  });

  it('a webhook with a wrong token is rejected with 401 before any DB work, not silently dropped after enqueue', async () => {
    const orderId = await createOrder('cash_on_delivery');
    const dispatched = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(201);
    const sliderOrderNumber =
      body<OrderDetailBody>(dispatched).externaldelivery!.sliderOrderNumber;
    const beforeCount = await jobCount('process_slider_webhook');

    await request(app.getHttpServer())
      .post('/slider/webhook')
      .set('x-slider-webhook-token', 'wrong-token')
      .send({
        order_number: sliderOrderNumber,
        order_id: orderId,
        status: 'in_transit',
        timestamp: Date.now(),
      })
      .expect(401);

    expect(await jobCount('process_slider_webhook')).toBe(beforeCount);
    const fetched = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // Still 'searching_rider' (the status set at dispatch) — the wrong-token
    // webhook never touched the row, and never even reached the DB.
    expect(body<OrderDetailBody>(fetched).externaldelivery?.status).toBe(
      'searching_rider',
    );
  });

  it('SLIDER_WEBHOOK_TOKEN unset means every request is rejected — fail closed, not open', async () => {
    const orderId = await createOrder('cash_on_delivery');
    const dispatched = await request(app.getHttpServer())
      .post(`/orders/${orderId}/slider-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleType: 'any' })
      .expect(201);
    const sliderOrderNumber =
      body<OrderDetailBody>(dispatched).externaldelivery!.sliderOrderNumber;
    const beforeCount = await jobCount('process_slider_webhook');

    const original = process.env.SLIDER_WEBHOOK_TOKEN;
    delete process.env.SLIDER_WEBHOOK_TOKEN;
    try {
      // Even the "correct" token from every other test in this file is
      // rejected once nothing is configured to compare it against — an
      // unconfigured secret must never be treated as "anything goes."
      await request(app.getHttpServer())
        .post('/slider/webhook')
        .set('x-slider-webhook-token', 'whsec_test_token')
        .send({
          order_number: sliderOrderNumber,
          order_id: orderId,
          status: 'delivered',
          timestamp: Date.now(),
        })
        .expect(401);
      await request(app.getHttpServer())
        .post('/slider/webhook')
        .send({
          order_number: sliderOrderNumber,
          order_id: orderId,
          status: 'delivered',
          timestamp: Date.now(),
        })
        .expect(401);
    } finally {
      process.env.SLIDER_WEBHOOK_TOKEN = original;
    }

    expect(await jobCount('process_slider_webhook')).toBe(beforeCount);
    // And definitely never ran the COD collect-cash cascade.
    const fetched = await request(app.getHttpServer())
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(body<OrderDetailBody>(fetched).cashCollectedAt).toBeNull();
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

  it('GET /slider-settings reports "connected" once enabled with an account id', async () => {
    const res = await request(app.getHttpServer())
      .get('/slider-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({
      enabled: true,
      accountId: 'acct_test',
      status: 'connected',
    });
  });

  it('never returns a Slider API key in any settings response (there is no per-shop key anymore)', async () => {
    const res = await request(app.getHttpServer())
      .get('/slider-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('sk_test_platform');
    expect(res.body).not.toHaveProperty('apiKey');
  });

  it('a shop that enabled Slider but has no account id yet is "awaiting_setup" and cannot dispatch', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Awaiting Setup Admin',
        email: `slider-awaiting-${runId}@test.com`,
        password: 'password123',
        shopName: 'Awaiting Setup Shop',
        subdomain: `slider-awaiting-${runId}`,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await request(app.getHttpServer())
      .patch('/slider-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true })
      .expect(200);

    const settings = await request(app.getHttpServer())
      .get('/slider-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(settings.body).toEqual({
      enabled: true,
      accountId: null,
      status: 'awaiting_setup',
    });

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const otherOutletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${otherOutletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        active: true,
        emirate: 'Dubai',
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
      })
      .expect(200);

    const orderId = await (async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/slider-awaiting-${runId}/orders`)
        .send({
          outletId: otherOutletId,
          customerName: 'X',
          customerPhone: '0501234567',
          customerAddress: '1 Sheikh Zayed Rd',
          emirate: 'Dubai',
          orderType: 'pickup',
          paymentMethod: 'cash_on_pickup',
          items: [],
        });
      return res.body as { order?: { id: number } };
    })();
    // No product/stock set up for this throwaway shop, so order creation
    // itself may 400 — this test only cares about the quote/dispatch guard,
    // which runs after order lookup, so skip if we couldn't create one.
    if (!orderId.order) return;

    const res = await request(app.getHttpServer())
      .post(`/orders/${orderId.order.id}/slider-delivery/quote`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(messageContains(res, 'Slider')).toBe(true);
  });

  // Session-cookie migration (security audit finding #1): slider-account-id
  // is a PATCH (state-changing), so the CSRF middleware (see AppModule.
  // configure) now runs before PlatformAdminGuard ever does — a request
  // with no valid session-cookie + CSRF-header pair is rejected at the CSRF
  // layer (403) before the guard's own 404-on-every-failure logic gets a
  // chance to run. This doesn't weaken the "don't reveal this surface
  // exists" property: the CSRF check applies uniformly to the whole
  // /platform-admin path prefix (real sub-route or not), and that prefix's
  // existence is already public via /platform-auth/login. GET routes are
  // unaffected (CSRF only guards state-changing methods) and still 404 on a
  // missing/wrong token — see platform-admin.e2e-spec.ts's 'separate JWT
  // scope' describe block for that coverage, and its own 'CSRF protection'
  // block for this same 403-before-404 behavior on suspend/unsuspend.
  it('a PATCH with no valid session+CSRF pair is rejected at the CSRF layer (403), not the guard (404) — old bearer-header attempts included', async () => {
    await request(app.getHttpServer())
      .patch(`/platform-admin/shops/${shopId}/slider-account-id`)
      .send({ accountId: 'acct_hacked' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/platform-admin/shops/${shopId}/slider-account-id`)
      .set('Authorization', 'Bearer wrong-token')
      .send({ accountId: 'acct_hacked' })
      .expect(403);
    // A real merchant token must not work here either — separate JWT scope.
    // Still no valid platform session cookie, so still 403 at the CSRF
    // layer, same as the two cases above.
    await request(app.getHttpServer())
      .patch(`/platform-admin/shops/${shopId}/slider-account-id`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accountId: 'acct_hacked' })
      .expect(403);
  });

  it('GET /webhook-log lists recent webhook activity for this shop', async () => {
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
        status: 'at_pickup',
        timestamp: Date.now(),
      })
      .expect(201);
    const jobId = await latestJobId('process_slider_webhook');
    expect(await jobsWorker.processJobById(jobId)).toBe(true);

    const res = await request(app.getHttpServer())
      .get('/webhook-log')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'slider',
          eventType: 'at_pickup',
          result: 'success',
        }),
      ]),
    );
  });
});
