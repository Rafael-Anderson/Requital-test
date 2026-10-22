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

jest.setTimeout(120000);

// F9: Google Maps degradation. Nominatim is faked (no outbound call): the
// global fetch is wrapped and only a nominatim.openstreetmap.org URL is
// answered, everything else goes to the real fetch.
interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OrderBody {
  order: { id: number };
}
interface ErrorBody {
  message: string | string[];
}
function body<T>(res: Response): T {
  return res.body as T;
}
function messageOf(res: Response): string {
  const { message } = body<ErrorBody>(res);
  return Array.isArray(message) ? message.join(' | ') : message;
}

const OUTLET_LAT = 25.2048;
const OUTLET_LON = 55.2708;
const FAR = { lat: '24.4539', lon: '54.3773' }; // Abu Dhabi, outside 5km
const NEAR = { lat: '25.2060', lon: '55.2720' };
const TYPED_ADDRESS = 'Villa 12, Street 4, Jumeirah 1';

describe('Maps degradation (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const shopSlug = `maps-${runId}`;
  const otherSlug = `maps-other-${runId}`;
  let adminToken: string;
  let otherToken: string;
  let outletId: number;
  let productId: number;

  type NominatimAnswer = 'near' | 'far' | 'empty' | 'fail';
  let nominatim: NominatimAnswer = 'near';
  let nominatimCalls: string[] = [];
  const realFetch = global.fetch;

  async function setupShop(slug: string, tag: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: `Maps ${tag}`,
        email: `maps-${tag}-${runId}@test.com`,
        password: 'password123',
        shopName: `Maps Shop ${tag}`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    return token;
  }

  beforeAll(async () => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes('nominatim.openstreetmap.org')) {
        return realFetch(input, init);
      }
      nominatimCalls.push(url);
      if (nominatim === 'fail') return Promise.reject(new Error('network'));
      const rows =
        nominatim === 'empty'
          ? []
          : [
              {
                lat: nominatim === 'far' ? FAR.lat : NEAR.lat,
                lon: nominatim === 'far' ? FAR.lon : NEAR.lon,
                display_name: 'Somewhere',
              },
            ];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(rows),
      } as unknown as globalThis.Response);
    });

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

    adminToken = await setupShop(shopSlug, 'a');
    otherToken = await setupShop(otherSlug, 'b');

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    outletId = body<IdRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        active: true,
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
      .send({ defaultDeliveryFee: 15 })
      .expect(200);
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose Bouquet',
        price: 100,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `MAPS-${runId}`,
        trackInventory: true,
        collectionIds: [body<IdRow>(collection).id],
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
    // The other shop only needs to exist and be published for beacon isolation.
    await request(app.getHttpServer())
      .patch(
        `/outlets/${
          body<IdRow[]>(
            await request(app.getHttpServer())
              .get('/outlets')
              .set('Authorization', `Bearer ${otherToken}`),
          )[0].id
        }`,
      )
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        active: true,
        deliveryEnabled: true,
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
        deliveryRadiusKm: 5,
      })
      .expect(200);
    const otherCollection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        name: 'Other',
        price: 10,
        thumbnail: 'https://example.com/o.jpg',
        sku: `MAPSO-${runId}`,
        collectionIds: [body<IdRow>(otherCollection).id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ published: true })
      .expect(200);
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await app.close();
  });

  beforeEach(() => {
    nominatim = 'near';
    nominatimCalls = [];
  });

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      outletId,
      customerName: 'Maps Customer',
      customerPhone: '0501234567',
      customerAddress: TYPED_ADDRESS,
      orderType: 'delivery',
      paymentMethod: 'cash_on_delivery',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }
  function place(overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`/public/${shopSlug}/orders`)
      .send(payload(overrides));
  }
  async function flagOf(orderId: number): Promise<number> {
    const rows = await db.query<RowDataPacket[]>(
      'SELECT addressUnverified FROM `order` WHERE id = ?',
      [orderId],
    );
    return Number(rows[0].addressUnverified);
  }

  describe('typed address when Maps is unavailable', () => {
    it('without the manual flag a radius outlet still demands coordinates', async () => {
      const res = await place().expect(400);
      expect(messageOf(res)).toContain('Your location is required');
      expect(nominatimCalls).toHaveLength(0);
    });

    it('geocodes the typed address, applies the radius to it, accepts and flags the order', async () => {
      const res = await place({ addressManual: true }).expect(201);
      expect(nominatimCalls).toHaveLength(1);
      expect(decodeURIComponent(nominatimCalls[0])).toContain(TYPED_ADDRESS);
      expect(await flagOf(body<OrderBody>(res).order.id)).toBe(1);
    });

    it('keeps the real rejection when the geocoded point is outside the radius', async () => {
      nominatim = 'far';
      const res = await place({ addressManual: true }).expect(400);
      expect(messageOf(res)).toContain('outside the outlet');
    });

    it('accepts and flags the order when the lookup fails', async () => {
      nominatim = 'fail';
      const res = await place({ addressManual: true }).expect(201);
      expect(await flagOf(body<OrderBody>(res).order.id)).toBe(1);
    });

    it('accepts and flags the order when the lookup finds nothing', async () => {
      nominatim = 'empty';
      const res = await place({ addressManual: true }).expect(201);
      expect(await flagOf(body<OrderBody>(res).order.id)).toBe(1);
    });

    it('rejects a typed address too short to be one', async () => {
      const res = await place({
        addressManual: true,
        customerAddress: 'Dubai',
      }).expect(400);
      expect(messageOf(res)).toContain('full delivery address');
    });

    it('ignores the flag when coordinates are given (no geocode, not flagged)', async () => {
      const res = await place({
        addressManual: true,
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
      }).expect(201);
      expect(nominatimCalls).toHaveLength(0);
      expect(await flagOf(body<OrderBody>(res).order.id)).toBe(0);
    });

    it('an ordinary pin order and a pickup order are never flagged', async () => {
      const pin = await place({
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
      }).expect(201);
      expect(await flagOf(body<OrderBody>(pin).order.id)).toBe(0);
      const pickup = await place({
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        addressManual: true,
      }).expect(201);
      expect(nominatimCalls).toHaveLength(0);
      expect(await flagOf(body<OrderBody>(pickup).order.id)).toBe(0);
    });

    it('the delivery quote stops demanding a pin with the flag, and never geocodes', async () => {
      const quote = (extra: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/public/${shopSlug}/delivery-quote`)
          .send({
            outletId,
            orderType: 'delivery',
            area: 'Jumeirah',
            items: [{ productId, quantity: 1 }],
            ...extra,
          });
      const without = await quote({});
      expect(body<{ status: string }>(without).status).toBe('needs_address');
      const withFlag = await quote({ addressManual: true });
      expect(
        body<{ status: string; deliveryFee: string }>(withFlag),
      ).toMatchObject({
        status: 'quoted',
        deliveryFee: '15',
      });
      expect(nominatimCalls).toHaveLength(0);
    });
  });

  describe('packing slip', () => {
    async function slipFor(orderId: number): Promise<string> {
      const created = await request(app.getHttpServer())
        .post('/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId, type: 'PACKING_SLIP' })
        .expect(201);
      const html = await request(app.getHttpServer())
        .get(`/invoices/${body<IdRow>(created).id}/pdf`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      return html.text;
    }

    it('prints the warning only for a flagged order', async () => {
      const flagged = await place({ addressManual: true }).expect(201);
      const plain = await place({
        latitude: OUTLET_LAT,
        longitude: OUTLET_LON,
      }).expect(201);
      const warning =
        'Address not verified on a map, please confirm with the customer';
      expect(await slipFor(body<OrderBody>(flagged).order.id)).toContain(
        warning,
      );
      expect(await slipFor(body<OrderBody>(plain).order.id)).not.toContain(
        warning,
      );
    });

    it('is surfaced on the admin order detail', async () => {
      const flagged = await place({ addressManual: true }).expect(201);
      const res = await request(app.getHttpServer())
        .get(`/orders/${body<OrderBody>(flagged).order.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ addressUnverified: boolean }>(res).addressUnverified).toBe(
        true,
      );
    });
  });

  describe('geocode endpoints', () => {
    it('GET /public/:shop/geocode answers from the (faked) lookup', async () => {
      const res = await request(app.getHttpServer())
        .get(`/public/${shopSlug}/geocode`)
        .query({ q: TYPED_ADDRESS })
        .expect(200);
      expect(body<{ latitude: number }>(res).latitude).toBeCloseTo(25.206, 3);
    });
  });

  describe('shopper beacon and merchant read', () => {
    const ownHost = `${shopSlug}.requital.io`;
    const send = (slug: string, payloadBody: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/public/${slug}/maps-error`)
        .send(payloadBody);
    const rowsFor = async (slug: string) => {
      const rows = await db.query<RowDataPacket[]>(
        'SELECT m.* FROM mapserrorlog m JOIN shop s ON s.id = m.shopId WHERE s.subdomain = ?',
        [slug],
      );
      return rows;
    };

    it("stores a known code from the shop's own host and counts repeats in one row", async () => {
      await send(shopSlug, {
        code: 'RefererNotAllowedMapError',
        host: ownHost.toUpperCase() + ':443',
      }).expect(204);
      await send(shopSlug, {
        code: 'RefererNotAllowedMapError',
        host: ownHost,
      }).expect(204);
      const rows = await rowsFor(shopSlug);
      const row = rows.find((r) => r.code === 'RefererNotAllowedMapError');
      expect(row).toBeDefined();
      expect(row!.host).toBe(ownHost);
      expect(Number(row!.hitCount)).toBe(2);
    });

    it('rejects an unknown code and a missing host with 400', async () => {
      await send(shopSlug, { code: 'SomethingElse', host: ownHost }).expect(
        400,
      );
      await send(shopSlug, { code: 'InvalidKeyMapError' }).expect(400);
      await send(shopSlug, {
        code: 'InvalidKeyMapError',
        host: ownHost,
        extra: 'x',
      }).expect(400);
    });

    it("silently drops a host that is not the shop's own (nothing stored)", async () => {
      await send(shopSlug, {
        code: 'BillingNotEnabledMapError',
        host: 'evil.example.com',
      }).expect(204);
      // Another shop's host does not count for this shop either, and the other
      // shop gets nothing from this shop's host.
      await send(shopSlug, {
        code: 'BillingNotEnabledMapError',
        host: `${otherSlug}.requital.io`,
      }).expect(204);
      await send(otherSlug, {
        code: 'BillingNotEnabledMapError',
        host: ownHost,
      }).expect(204);
      expect(
        (await rowsFor(shopSlug)).some(
          (r) => r.code === 'BillingNotEnabledMapError',
        ),
      ).toBe(false);
      expect(await rowsFor(otherSlug)).toHaveLength(0);
    });

    it('an unknown shop is a 404', async () => {
      await send('no-such-shop-xyz', {
        code: 'InvalidKeyMapError',
        host: 'x.requital.io',
      }).expect(404);
    });

    it('GET /shop/maps-health is admin only and tenant scoped', async () => {
      const mine = await request(app.getHttpServer())
        .get('/shop/maps-health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        body<{ errors: { code: string; host: string }[] }>(mine).errors,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'RefererNotAllowedMapError',
            host: ownHost,
          }),
        ]),
      );
      const other = await request(app.getHttpServer())
        .get('/shop/maps-health')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);
      expect(body<{ errors: unknown[] }>(other).errors).toHaveLength(0);
      await request(app.getHttpServer()).get('/shop/maps-health').expect(401);

      const viewerEmail = `maps-viewer-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Viewer',
          email: viewerEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: viewerEmail, password: 'password123' })
        .expect(201);
      await request(app.getHttpServer())
        .get('/shop/maps-health')
        .set('Authorization', `Bearer ${body<AuthResponse>(login).accessToken}`)
        .expect(403);
    });
  });
});
