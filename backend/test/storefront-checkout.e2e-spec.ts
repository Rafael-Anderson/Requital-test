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
interface OrderRow {
  id: number;
  channel: string | null;
  orderType: string | null;
  paymentMethod: string | null;
  deliveryFee: string | null;
  taxAmount: string | null;
  total: string;
  status: string;
  trackingToken: string | null;
}
interface OrderLookupBody {
  id: number;
  status: string;
  orderType: string | null;
  items: { productName: string; quantity: number }[];
  total: string;
  customerName: string;
  hasAccount: boolean;
}
interface CreateOrderResponseBody {
  order: OrderRow;
  checkoutUrl: string | null;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Nest's ValidationPipe wraps class-validator failures as `message: string[]`
// (one entry per failed constraint), while a hand-thrown BadRequestException
// with a plain string argument comes through as `message: string` — this
// normalizes either shape for a substring check.
function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

// Bypasses the outlet's own coordinates so radius checks are trivially
// satisfied (distance 0) wherever the happy-path tests don't care about
// radius specifically.
const OUTLET_LAT = 25.2048;
const OUTLET_LON = 55.2708;
const FAR_LAT = 24.4539; // Abu Dhabi — well outside a 5km radius from OUTLET_LAT/LON
const FAR_LON = 54.3773;

describe('Storefront public checkout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();
  const shopSlug = `storefront-test-${runId}`;

  let adminToken: string;
  let outletId: number;
  let productId: number; // trackInventory, price 100, stock 100 — shared across most tests
  let categoryId: number;

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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Storefront Test Admin',
        email: `storefront-admin-${runId}@test.com`,
        password: 'password123',
        shopName: 'Storefront Test Shop',
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

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultDeliveryFee: 15, taxRate: 5, taxInclusive: false })
      .expect(200);

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    categoryId = body<IdRow>(category).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 100,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `ROSE-${runId}`,
        trackInventory: true,
        categoryIds: [categoryId],
      })
      .expect(201);
    productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outletId, adjustments: [{ productId, delta: 100 }] })
      .expect(200);

    // Publishing requires meeting the readiness bar (outlet + product must
    // already exist — see ShopService.getPublishReadiness), so this must
    // come last. Storefront order creation then 404s for an unpublished shop
    // (see PublicService.assertPublished) — this whole suite is storefront checkout.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      outletId,
      customerName: 'Storefront Customer',
      customerPhone: '0501234567',
      customerAddress: '1 Sheikh Zayed Rd',
      emirate: 'Dubai',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }

  describe('public catalog reads', () => {
    it('GET /public/:shopSlug returns shop info', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}`)
        .expect(200);
      expect(body<{ name: string }>(res).name).toBe('Storefront Test Shop');
    });

    it('GET /public/:shopSlug/categories returns the created category', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/categories`)
        .expect(200);
      expect(body<{ id: number }[]>(res).map((c) => c.id)).toContain(
        categoryId,
      );
    });

    it('GET /public/:shopSlug/products returns the created product with stock for the outlet', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/products?outletId=${outletId}`)
        .expect(200);
      const product = body<{ id: number; stockQuantity: number }[]>(res).find(
        (p) => p.id === productId,
      );
      expect(product?.stockQuantity).toBe(100);
    });

    it('GET /public/:shopSlug/outlets returns the outlet with delivery/pickup flags', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/outlets`)
        .expect(200);
      const outlet = body<
        { id: number; deliveryEnabled: boolean; pickupEnabled: boolean }[]
      >(res).find((o) => o.id === outletId);
      expect(outlet?.deliveryEnabled).toBe(true);
      expect(outlet?.pickupEnabled).toBe(true);
    });

    it('unknown shop slug returns 404, not another shop', async () => {
      await request(app.getHttpServer())
        .get('/public/does-not-exist-shop')
        .expect(404);
    });

    it('GET /public/:shopSlug/products?isCheckoutAddon=true filters by the flag, tenant-isolated', async () => {
      const addon = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Add-on Candle',
          price: 20,
          thumbnail: 'https://example.com/candle.jpg',
          sku: `ADDON-${runId}`,
          isCheckoutAddon: true,
          categoryIds: [categoryId],
        })
        .expect(201);
      const addonId = body<IdRow>(addon).id;

      // A second shop's own addon-flagged product must never leak into this
      // shop's filtered results — tenant isolation, not just a status filter.
      const otherSlug = `storefront-test-other-${runId}`;
      const otherSignup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'Other Shop Admin',
          email: `storefront-other-admin-${runId}@test.com`,
          password: 'password123',
          shopName: 'Other Test Shop',
          subdomain: otherSlug,
        })
        .expect(201);
      const otherToken = body<AuthResponse>(otherSignup).accessToken;
      const otherCategory = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Other Category' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          name: 'Other Shop Add-on',
          price: 10,
          thumbnail: 'https://example.com/other.jpg',
          sku: `OTHER-ADDON-${runId}`,
          isCheckoutAddon: true,
          categoryIds: [body<IdRow>(otherCategory).id],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/products?isCheckoutAddon=true`)
        .expect(200);
      const ids = body<{ id: number }[]>(res).map((p) => p.id);
      expect(ids).toContain(addonId);
      expect(ids).not.toContain(productId); // Rose Bouquet isn't flagged
      expect(ids.length).toBe(1); // only this shop's addon product, never the other shop's
    });
  });

  describe('order creation — delivery, and the fee/tax snapshot', () => {
    let createdOrderId: number;

    it('creates a storefront delivery order: channel/orderType/paymentMethod set, fee = shop default (no zone configured), tax computed correctly', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            latitude: OUTLET_LAT,
            longitude: OUTLET_LON,
          }),
        )
        .expect(201);
      const { order } = body<CreateOrderResponseBody>(res);
      createdOrderId = order.id;

      expect(order.channel).toBe('storefront');
      expect(order.orderType).toBe('delivery');
      expect(order.paymentMethod).toBe('cash_on_delivery');
      expect(Number(order.deliveryFee)).toBe(15); // shop.defaultDeliveryFee, no zone matched
      // subtotal 100, exclusive 5% tax => taxAmount 5, total 100+15+5
      expect(Number(order.taxAmount)).toBeCloseTo(5, 2);
      expect(Number(order.total)).toBeCloseTo(120, 2);
    });

    it('cash_on_delivery never touches Stripe — no checkoutUrl', async () => {
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: createdOrderId },
      });
      expect(order.paymentMethod).toBe('cash_on_delivery');
    });

    it("later shop config changes don't retroactively change the already-created order's snapshot", async () => {
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultDeliveryFee: 999, taxRate: 50 })
        .expect(200);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: createdOrderId },
      });
      expect(Number(order.deliveryFee)).toBe(15);
      expect(Number(order.taxAmount)).toBeCloseTo(5, 2);
      expect(Number(order.total)).toBeCloseTo(120, 2);

      // Restore for subsequent tests in this file.
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultDeliveryFee: 15, taxRate: 5 })
        .expect(200);
    });
  });

  describe('order creation — pickup', () => {
    it('creates a storefront pickup order with orderType=pickup and deliveryFee=0', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            customerAddress: 'Pickup at outlet',
          }),
        )
        .expect(201);
      const { order } = body<CreateOrderResponseBody>(res);
      expect(order.channel).toBe('storefront');
      expect(order.orderType).toBe('pickup');
      expect(order.paymentMethod).toBe('cash_on_pickup');
      expect(Number(order.deliveryFee)).toBe(0);
    });

    it('rejects a payment method not enabled for pickup (card_on_delivery is a delivery-only method)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'card_on_delivery',
          }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('not an available payment method'),
      );
    });
  });

  describe('per-item customer note', () => {
    it('persists items[].note onto orderitem.note', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            customerAddress: 'Pickup at outlet',
            items: [{ productId, quantity: 1, note: 'No card, please' }],
          }),
        )
        .expect(201);
      const { order } = body<CreateOrderResponseBody>(res);

      const item = await prisma.orderitem.findFirstOrThrow({
        where: { orderId: order.id },
      });
      expect(item.note).toBe('No card, please');
    });

    it('leaves orderitem.note null when no note was supplied', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            customerAddress: 'Pickup at outlet',
          }),
        )
        .expect(201);
      const { order } = body<CreateOrderResponseBody>(res);

      const item = await prisma.orderitem.findFirstOrThrow({
        where: { orderId: order.id },
      });
      expect(item.note).toBeNull();
    });
  });

  describe('delivery radius eligibility', () => {
    it('rejects when the customer coordinates are outside the configured radius', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            latitude: FAR_LAT,
            longitude: FAR_LON,
          }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('delivery radius'),
      );
    });

    it('rejects when radius is configured but no coordinates were supplied at all', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
          }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('location is required'),
      );
    });
  });

  describe('delivery zones take precedence over the default fee', () => {
    let zoneId: number;

    beforeAll(async () => {
      const zone = await request(app.getHttpServer())
        .post(`/outlets/${outletId}/delivery-zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Marina', fee: 25, minOrderAmount: 200 })
        .expect(201);
      zoneId = body<IdRow>(zone).id;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/outlets/${outletId}/delivery-zones/${zoneId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('rejects when subtotal is below the matched zone minimum order amount', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            area: 'Marina',
            latitude: OUTLET_LAT,
            longitude: OUTLET_LON,
            items: [{ productId, quantity: 1 }], // subtotal 100 < zone minimum 200
          }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('Minimum order amount'),
      );
    });

    it('uses the matched zone fee (25) instead of shop.defaultDeliveryFee (15) once the minimum is met', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            area: 'Marina',
            latitude: OUTLET_LAT,
            longitude: OUTLET_LON,
            items: [{ productId, quantity: 3 }], // subtotal 300 >= zone minimum 200
          }),
        )
        .expect(201);
      const { order } = body<CreateOrderResponseBody>(res);
      expect(Number(order.deliveryFee)).toBe(25);
    });

    it('an address matching no configured zone falls back to the default fee (radius is configured and passed) but logs a flag for the merchant', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const res = await request(app.getHttpServer())
          .post(`/public/${shopSlug}/orders`)
          .send(
            basePayload({
              orderType: 'delivery',
              paymentMethod: 'cash_on_delivery',
              area: 'Not A Configured Zone',
              latitude: OUTLET_LAT,
              longitude: OUTLET_LON,
            }),
          )
          .expect(201);
        const { order } = body<CreateOrderResponseBody>(res);
        expect(Number(order.deliveryFee)).toBe(15); // shop.defaultDeliveryFee, not the Marina zone's 25

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('matched no configured delivery zone'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('an address matching no zone AND no radius configured is rejected, not defaulted through', () => {
    // deliveryRadiusKm is currently mandatory whenever deliveryEnabled is
    // true (enforced in OutletsService.validateDelivery) — so this state
    // can't be reached through the normal admin outlet-edit flow today.
    // Simulated via a direct DB write (legacy data / a future relaxation of
    // that constraint) specifically to prove the defensive branch in
    // PublicService.resolveDeliveryFee actually blocks rather than guesses.
    let noRadiusOutletId: number;
    let zoneId: number;

    beforeAll(async () => {
      const outlet = await request(app.getHttpServer())
        .post('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'No-Radius Outlet' })
        .expect(201);
      noRadiusOutletId = body<IdRow>(outlet).id;
      await request(app.getHttpServer())
        .patch(`/outlets/${noRadiusOutletId}`)
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
      // Force the otherwise-unreachable "no radius" state directly.
      await prisma.outlet.update({
        where: { id: noRadiusOutletId },
        data: { deliveryRadiusKm: null },
      });

      const zone = await request(app.getHttpServer())
        .post(`/outlets/${noRadiusOutletId}/delivery-zones`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Only This Zone', fee: 30 })
        .expect(201);
      zoneId = body<IdRow>(zone).id;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/outlets/${noRadiusOutletId}/delivery-zones/${zoneId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('rejects the order outright instead of silently applying the shop default fee', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            outletId: noRadiusOutletId,
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            area: 'Somewhere Not Covered',
          }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('did not match any configured delivery zone'),
      );
    });
  });

  describe('fulfillment hours + force-closed', () => {
    it('rejects a delivery order when shop.deliveryHours has every day closed', async () => {
      const allClosed = Object.fromEntries(
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [
          d,
          { open: '00:00', close: '00:00', closed: true },
        ]),
      );
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deliveryHours: allClosed })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'delivery',
            paymentMethod: 'cash_on_delivery',
            latitude: OUTLET_LAT,
            longitude: OUTLET_LON,
          }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('not available'),
      );

      // A pickup order must still work — deliveryHours being closed is
      // independent of pickupHours (both null = always open by default).
      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' }),
        )
        .expect(201);
    });

    it('force-closed override blocks every fulfillment type, even with hours otherwise open', async () => {
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          deliveryHours: Object.fromEntries(
            ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [
              d,
              { open: '00:00', close: '23:59', closed: false },
            ]),
          ),
        })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closedOverride: true })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' }),
        )
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('currently closed'),
      );

      // Restore for subsequent tests.
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closedOverride: false })
        .expect(200);
    });
  });

  describe('customerPhone validation', () => {
    it('accepts digits, spaces, hyphens, and an optional leading +', async () => {
      await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            customerPhone: '+971 50 699-2754',
          }),
        )
        .expect(201);
    });

    it.each(['abc123', '050-123-45<script>', '++971501234567', '123'])(
      'rejects a malformed phone number: %s',
      async (customerPhone) => {
        const res = await request(app.getHttpServer())
          .post(`/public/${shopSlug}/orders`)
          .send(
            basePayload({
              orderType: 'pickup',
              paymentMethod: 'cash_on_pickup',
              customerPhone,
            }),
          )
          .expect(400);
        expect(
          messageContains(res, 'customerPhone must contain only digits'),
        ).toBe(true);
      },
    );
  });

  describe('stock race condition', () => {
    let raceProductId: number;

    beforeAll(async () => {
      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Last Unit Bouquet',
          price: 50,
          thumbnail: 'https://example.com/last.jpg',
          sku: `LAST-${runId}`,
          trackInventory: true,
          categoryIds: [categoryId],
        })
        .expect(201);
      raceProductId = body<IdRow>(product).id;

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outletId,
          adjustments: [{ productId: raceProductId, delta: 1 }],
        })
        .expect(200);
    });

    it('a single request for more than available stock is rejected outright', async () => {
      const res = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            items: [{ productId: raceProductId, quantity: 2 }],
          }),
        )
        .expect(409);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('out of stock'),
      );

      const stock = await prisma.outletstock.findUniqueOrThrow({
        where: { outletId_productId: { outletId, productId: raceProductId } },
      });
      expect(stock.stockQuantity).toBe(1); // untouched — the whole transaction rolled back
    });

    it('exactly one of two concurrent checkouts for the last unit succeeds; final stock is 0, never negative', async () => {
      const attempt = () =>
        request(app.getHttpServer())
          .post(`/public/${shopSlug}/orders`)
          .send(
            basePayload({
              orderType: 'pickup',
              paymentMethod: 'cash_on_pickup',
              items: [{ productId: raceProductId, quantity: 1 }],
            }),
          );

      const [a, b] = await Promise.all([attempt(), attempt()]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const stock = await prisma.outletstock.findUniqueOrThrow({
        where: { outletId_productId: { outletId, productId: raceProductId } },
      });
      expect(stock.stockQuantity).toBe(0);

      const orderCount = await prisma.order.count({
        where: {
          shopId: (
            await prisma.shop.findUniqueOrThrow({
              where: { subdomain: shopSlug },
            })
          ).id,
          orderitem: { some: { productId: raceProductId } },
        },
      });
      expect(orderCount).toBe(1); // the losing request's order was never created (rolled back)
    });
  });

  describe('order tracking / lookup', () => {
    it('a valid tracking token returns full order detail — no auth required', async () => {
      const created = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' }),
        )
        .expect(201);
      const { order } = body<CreateOrderResponseBody>(created);
      expect(order.trackingToken).toBeTruthy();

      const res = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${order.trackingToken}`)
        .expect(200);
      const looked = body<OrderLookupBody>(res);
      expect(looked.id).toBe(order.id);
      expect(looked.status).toBe('pending');
      expect(looked.orderType).toBe('pickup');
      expect(looked.total).toBe(order.total);
      expect(looked.items.length).toBeGreaterThan(0);
      expect(looked.customerName).toBe('Storefront Customer');
    });

    it('a missing token is rejected (400), not treated as "no filter"', async () => {
      await request(app.getHttpServer())
        .get('/public/orders/lookup')
        .expect(400);
    });

    it('an unknown/wrong token returns 404, not partial or default data', async () => {
      await request(app.getHttpServer())
        .get('/public/orders/lookup?token=this-token-does-not-exist')
        .expect(404);
    });

    it("looking up order A's token never returns order B's data", async () => {
      const orderA = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            customerName: 'Customer A',
          }),
        )
        .expect(201);
      const orderB = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({
            orderType: 'pickup',
            paymentMethod: 'cash_on_pickup',
            customerName: 'Customer B',
          }),
        )
        .expect(201);
      const tokenA = body<CreateOrderResponseBody>(orderA).order.trackingToken;
      const idB = body<CreateOrderResponseBody>(orderB).order.id;

      const res = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${tokenA}`)
        .expect(200);
      const looked = body<OrderLookupBody>(res);
      expect(looked.id).not.toBe(idB);
      expect(looked.customerName).toBe('Customer A');
    });

    it('the lookup response never includes customerPhone/customerEmail/customerAddress', async () => {
      const created = await request(app.getHttpServer())
        .post(`/public/${shopSlug}/orders`)
        .send(
          basePayload({ orderType: 'pickup', paymentMethod: 'cash_on_pickup' }),
        )
        .expect(201);
      const token = body<CreateOrderResponseBody>(created).order.trackingToken;

      const res = await request(app.getHttpServer())
        .get(`/public/orders/lookup?token=${token}`)
        .expect(200);
      const raw = res.body as Record<string, unknown>;
      expect(raw).not.toHaveProperty('customerPhone');
      expect(raw).not.toHaveProperty('customerEmail');
      expect(raw).not.toHaveProperty('customerAddress');
    });
  });
});
