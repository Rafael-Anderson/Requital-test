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
interface RegionPayload {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
}
interface RegionsBody {
  country: { code: string; regionLabel: string } | null;
  regions: RegionPayload[];
}
interface OrderBody {
  id: number;
  emirate: string | null;
  regionId: number | null;
  region: RegionPayload | null;
  deliveryFee?: string | null;
}
interface ErrorBody {
  message: string | string[];
}
function body<T>(res: Response): T {
  return res.body as T;
}

// Phase 2b / PR-B. The six `@IsIn(EMIRATES)` validators are gone; every write
// path that stores an address region goes through RegionsService.resolveForShop,
// which checks the region against the SHOP'S OWN country. This spec walks each
// such path, the deprecated `emirate` alias, and the tenant boundary (a region
// of another country is refused).
describe('Region validation (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const server = () => app.getHttpServer();

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

  afterAll(async () => {
    await app.close();
  });

  async function regionId(code: string): Promise<number> {
    const rows = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM region WHERE code = ?`,
      [code],
    );
    return rows[0].id;
  }

  // A published, stocked shop with a pickup outlet. `country` undefined leaves
  // countryCode NULL (how every pre-existing test shop is created).
  async function setupShop(prefix: string, country?: string) {
    const slug = `${prefix}-${runId}`;
    const signup = await request(server())
      .post('/auth/signup')
      .send({
        name: 'Region Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
        ...(country && { country }),
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      server(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(server())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(server())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: true, pickupEnabled: true })
      .expect(200);

    const collection = await request(server())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Region Collection' })
      .expect(201);
    const product = await request(server())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Region Rose',
        price: 20,
        thumbnail: 'https://example.com/r.jpg',
        sku: `REG-${slug}`,
        trackInventory: true,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;
    await request(server())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, adjustments: [{ productId, delta: 100 }] })
      .expect(200);
    await request(server())
      .patch('/shop')
      .set('Authorization', `Bearer ${token}`)
      .send({ published: true })
      .expect(200);
    return { slug, token, outletId, productId };
  }

  type Shop = Awaited<ReturnType<typeof setupShop>>;

  const adminOrder = (shop: Shop, region: Record<string, unknown>) =>
    request(server())
      .post('/orders')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        customerName: 'Region Customer',
        customerPhone: `region-${Math.random().toString(36).slice(2, 8)}`,
        customerAddress: '1 Region St',
        outletId: shop.outletId,
        orderType: 'pickup',
        items: [{ productId: shop.productId, quantity: 1 }],
        ...region,
      });

  const publicOrder = (
    shop: Shop,
    region: Record<string, unknown>,
    extra = {},
  ) =>
    request(server())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'Region Shopper',
        customerPhone: '0501234567',
        customerAddress: '1 Region St',
        items: [{ productId: shop.productId, quantity: 1 }],
        ...region,
        ...extra,
      });

  describe('region list endpoints', () => {
    it('public: an AE shop is offered the 7 emirates, with Arabic names and a country label', async () => {
      const shop = await setupShop('rl-ae', 'United Arab Emirates');
      const res = body<RegionsBody>(
        await request(server()).get(`/public/${shop.slug}/regions`).expect(200),
      );
      expect(res.country).toEqual({ code: 'AE', regionLabel: 'Emirate' });
      expect(res.regions.map((r) => r.nameEn)).toEqual([
        'Abu Dhabi',
        'Dubai',
        'Sharjah',
        'Ajman',
        'Umm Al Quwain',
        'Ras Al Khaimah',
        'Fujairah',
      ]);
      expect(res.regions.find((r) => r.code === 'AE-DU')?.nameAr).toBe('دبي');
    });

    it('public: an SA shop is offered Saudi regions, never the UAE ones', async () => {
      const shop = await setupShop('rl-sa', 'Saudi Arabia');
      const res = body<RegionsBody>(
        await request(server()).get(`/public/${shop.slug}/regions`).expect(200),
      );
      expect(res.country?.code).toBe('SA');
      expect(res.regions).toHaveLength(13);
      expect(res.regions.some((r) => r.nameEn === 'Dubai')).toBe(false);
    });

    it('public: a shop with no country code gets no regions and no country, nothing guessed', async () => {
      const shop = await setupShop('rl-none');
      const res = body<RegionsBody>(
        await request(server()).get(`/public/${shop.slug}/regions`).expect(200),
      );
      expect(res).toEqual({ country: null, regions: [] });
    });

    it('public: an unknown shop slug is a 404', async () => {
      await request(server())
        .get(`/public/no-such-shop-${runId}/regions`)
        .expect(404);
    });

    it('staff: GET /regions is scoped to the caller shop country, not a parameter', async () => {
      const ae = await setupShop('rl-staff-ae', 'United Arab Emirates');
      const kw = await setupShop('rl-staff-kw', 'Kuwait');
      const aeRes = body<RegionsBody>(
        await request(server())
          .get('/regions')
          .set('Authorization', `Bearer ${ae.token}`)
          .expect(200),
      );
      const kwRes = body<RegionsBody>(
        await request(server())
          .get('/regions')
          .query({ countryCode: 'AE' }) // ignored: no such parameter exists
          .set('Authorization', `Bearer ${kw.token}`)
          .expect(200),
      );
      expect(aeRes.country?.code).toBe('AE');
      expect(kwRes.country?.code).toBe('KW');
      expect(kwRes.regions).toHaveLength(6);
    });

    it('staff: GET /regions needs a login', async () => {
      await request(server()).get('/regions').expect(401);
    });
  });

  describe('POST /orders (admin), a required region', () => {
    let ae: Shop;
    let sa: Shop;
    let legacy: Shop;
    beforeAll(async () => {
      ae = await setupShop('ord-ae', 'United Arab Emirates');
      sa = await setupShop('ord-sa', 'Saudi Arabia');
      legacy = await setupShop('ord-legacy');
    });

    it('accepts a regionId of the shop country, stores it, mirrors the name, and returns the region', async () => {
      const dubai = await regionId('AE-DU');
      const res = await adminOrder(ae, { regionId: dubai }).expect(201);
      const order = body<OrderBody>(res);
      expect(order.regionId).toBe(dubai);
      expect(order.emirate).toBe('Dubai');
      const rows = await db.query<(OrderBody & RowDataPacket)[]>(
        `SELECT regionId, emirate FROM \`order\` WHERE id = ?`,
        [order.id],
      );
      expect(rows[0].regionId).toBe(dubai);
      expect(rows[0].emirate).toBe('Dubai');
    });

    it('the deprecated emirate alias still works and resolves to the same region', async () => {
      const res = await adminOrder(ae, { emirate: 'Sharjah' }).expect(201);
      expect(body<OrderBody>(res).regionId).toBe(await regionId('AE-SH'));
    });

    it('refuses a region of another country, an unknown id, a mismatched pair and no region at all', async () => {
      const riyadh = await regionId('SA-01');
      const dubai = await regionId('AE-DU');
      const sharjahName = 'Sharjah';
      await adminOrder(ae, { regionId: riyadh }).expect(400);
      await adminOrder(ae, { regionId: 999999999 }).expect(400);
      await adminOrder(ae, { regionId: dubai, emirate: sharjahName }).expect(
        400,
      );
      await adminOrder(ae, { emirate: 'Riyadh' }).expect(400);
      await adminOrder(ae, {}).expect(400);
    });

    it('an SA shop takes a Saudi region and refuses a UAE emirate by id or by name', async () => {
      await adminOrder(sa, { regionId: await regionId('SA-01') }).expect(201);
      await adminOrder(sa, { regionId: await regionId('AE-DU') }).expect(400);
      await adminOrder(sa, { emirate: 'Dubai' }).expect(400);
    });

    it('one message for "no such region" and "another country region", so ids cannot be probed', async () => {
      const other = await adminOrder(ae, { regionId: await regionId('SA-01') });
      const missing = await adminOrder(ae, { regionId: 999999999 });
      expect(body<ErrorBody>(other).message).toEqual(
        body<ErrorBody>(missing).message,
      );
    });

    it('a shop with no country code keeps the old UAE-emirate meaning for the alias, records no region, refuses a regionId', async () => {
      const res = await adminOrder(legacy, { emirate: 'Dubai' }).expect(201);
      const order = body<OrderBody>(res);
      expect(order.emirate).toBe('Dubai');
      expect(order.regionId).toBeNull(); // unknown country, so no region is asserted
      await adminOrder(legacy, { emirate: 'Riyadh' }).expect(400);
      await adminOrder(legacy, { regionId: await regionId('AE-DU') }).expect(
        400,
      );
      // Nothing to choose from, so nothing is required: a shop whose country is
      // unknown offers no regions and must still be able to take an order.
      const bare = body<OrderBody>(await adminOrder(legacy, {}).expect(201));
      expect(bare.emirate).toBeNull();
      expect(bare.regionId).toBeNull();
    });
  });

  describe('POST /public/:shopSlug/orders (storefront checkout)', () => {
    it('takes a regionId alone; an order never needs the old emirate field', async () => {
      const shop = await setupShop('pub-ae', 'United Arab Emirates');
      const res = await publicOrder(shop, {
        regionId: await regionId('AE-AJ'),
      }).expect(201);
      const order = body<{ order: OrderBody }>(res).order;
      expect(order.regionId).toBe(await regionId('AE-AJ'));
      expect(order.emirate).toBe('Ajman');
    });

    it('refuses another country region, a wrong-country emirate name and a missing region', async () => {
      const shop = await setupShop('pub-sa', 'Saudi Arabia');
      await publicOrder(shop, { regionId: await regionId('AE-DU') }).expect(
        400,
      );
      await publicOrder(shop, { emirate: 'Dubai' }).expect(400);
      await publicOrder(shop, { regionId: await regionId('SA-02') }).expect(
        201,
      );
    });

    it('a region is required for DELIVERY in a country that has regions, and never for pickup', async () => {
      const shop = await setupShop('pub-req', 'United Arab Emirates');
      await request(server())
        .patch(`/outlets/${shop.outletId}`)
        .set('Authorization', `Bearer ${shop.token}`)
        .send({
          deliveryEnabled: true,
          latitude: 25.2048,
          longitude: 55.2708,
          deliveryRadiusKm: 5,
        })
        .expect(200);
      const delivery = {
        orderType: 'delivery',
        paymentMethod: 'cash_on_delivery',
        latitude: 25.2048,
        longitude: 55.2708,
      };
      const res = await publicOrder(shop, {}, delivery).expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('regionId is required'),
      );
      // Pickup gives no address to place in a region, so none is stored and none is made up.
      const pickup = body<{ order: OrderBody }>(
        await publicOrder(shop, {}).expect(201),
      ).order;
      expect(pickup.regionId).toBeNull();
      expect(pickup.emirate).toBeNull();
    });

    it('zone matching uses the resolved region name, so a regionId-only order still gets its zone fee', async () => {
      const shop = await setupShop('pub-zone', 'United Arab Emirates');
      await request(server())
        .patch(`/outlets/${shop.outletId}`)
        .set('Authorization', `Bearer ${shop.token}`)
        .send({
          deliveryEnabled: true,
          latitude: 25.2048,
          longitude: 55.2708,
          deliveryRadiusKm: 5,
        })
        .expect(200);
      // Seeded directly: a zone with no regions is a legacy one, matched by name.
      await db.execute(
        'INSERT INTO deliveryzone (outletId, name, fee, minOrderAmount, isActive) VALUES (?, ?, ?, 0, 1)',
        [shop.outletId, 'Sharjah', 40],
      );
      const res = await publicOrder(
        shop,
        { regionId: await regionId('AE-SH') },
        {
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          latitude: 25.2048,
          longitude: 55.2708,
        },
      ).expect(201);
      expect(Number(body<{ order: OrderBody }>(res).order.deliveryFee)).toBe(
        40,
      );
    });
  });

  describe('draft orders', () => {
    const draft = (shop: Shop, region: Record<string, unknown>) =>
      request(server())
        .post('/shop/draft-orders')
        .set('Authorization', `Bearer ${shop.token}`)
        .send({
          outletId: shop.outletId,
          customerName: 'Draft Customer',
          customerPhone: `05${Math.floor(Math.random() * 100000000)}`,
          customerAddress: '1 Draft St',
          orderType: 'pickup',
          items: [{ productId: shop.productId, quantity: 1 }],
          ...region,
        });

    it('create: required, country-checked, stored with its region', async () => {
      const ae = await setupShop('dr-ae', 'United Arab Emirates');
      const ok = await draft(ae, { regionId: await regionId('AE-DU') }).expect(
        201,
      );
      expect(body<OrderBody>(ok).region?.code).toBe('AE-DU');
      await draft(ae, { regionId: await regionId('SA-01') }).expect(400);
      await draft(ae, {}).expect(400);
    });

    it('update: optional, re-checked only when changed, and untouched when absent', async () => {
      const ae = await setupShop('dr-upd', 'United Arab Emirates');
      const created = body<OrderBody>(
        await draft(ae, { regionId: await regionId('AE-DU') }).expect(201),
      );
      const patch = (payload: Record<string, unknown>) =>
        request(server())
          .patch(`/shop/draft-orders/${created.id}`)
          .set('Authorization', `Bearer ${ae.token}`)
          .send(payload);

      const moved = body<OrderBody>(
        await patch({ regionId: await regionId('AE-SH') }).expect(200),
      );
      expect(moved.region?.code).toBe('AE-SH');
      expect(moved.emirate).toBe('Sharjah');
      await patch({ regionId: await regionId('SA-01') }).expect(400);
      const unchanged = body<OrderBody>(
        await patch({ customerName: 'Renamed' }).expect(200),
      );
      expect(unchanged.region?.code).toBe('AE-SH');
    });

    it('completing a draft carries the region through to the real order', async () => {
      const ae = await setupShop('dr-done', 'United Arab Emirates');
      const created = body<OrderBody>(
        await draft(ae, { regionId: await regionId('AE-FU') }).expect(201),
      );
      const done = body<{ convertedOrderId: number }>(
        await request(server())
          .post(`/shop/draft-orders/${created.id}/complete`)
          .set('Authorization', `Bearer ${ae.token}`)
          .expect(201),
      );
      const rows = await db.query<(OrderBody & RowDataPacket)[]>(
        `SELECT regionId, emirate FROM \`order\` WHERE id = ?`,
        [done.convertedOrderId],
      );
      expect(rows[0].regionId).toBe(await regionId('AE-FU'));
      expect(rows[0].emirate).toBe('Fujairah');
    });

    it('a legacy draft holding no region is refused at completion, not cast into a NOT NULL error', async () => {
      const ae = await setupShop('dr-legacy', 'United Arab Emirates');
      const created = body<OrderBody>(
        await draft(ae, { regionId: await regionId('AE-DU') }).expect(201),
      );
      await db.execute(
        `UPDATE draftorder SET emirate = NULL, regionId = NULL WHERE id = ?`,
        [created.id],
      );
      const res = await request(server())
        .post(`/shop/draft-orders/${created.id}/complete`)
        .set('Authorization', `Bearer ${ae.token}`)
        .expect(400);
      expect(body<ErrorBody>(res).message).toEqual(
        expect.stringContaining('regionId is required'),
      );
    });
  });

  describe('outlets', () => {
    it('PATCH: a region of the shop country is stored; another country region and a wrong alias are refused', async () => {
      const sa = await setupShop('out-sa', 'Saudi Arabia');
      const patch = (payload: Record<string, unknown>) =>
        request(server())
          .patch(`/outlets/${sa.outletId}`)
          .set('Authorization', `Bearer ${sa.token}`)
          .send(payload);
      const ok = body<OrderBody>(
        await patch({ regionId: await regionId('SA-03') }).expect(200),
      );
      expect(ok.region?.code).toBe('SA-03');
      await patch({ regionId: await regionId('AE-DU') }).expect(400);
      await patch({ emirate: 'Dubai' }).expect(400);
    });

    it('PATCH: a shop with no country code still accepts the alias (existing behaviour), storing no region', async () => {
      const legacy = await setupShop('out-legacy');
      const res = body<OrderBody>(
        await request(server())
          .patch(`/outlets/${legacy.outletId}`)
          .set('Authorization', `Bearer ${legacy.token}`)
          .send({ emirate: 'Dubai' })
          .expect(200),
      );
      expect(res.emirate).toBe('Dubai');
      expect(res.regionId).toBeNull();
    });

    it('PATCH: leaving the region out never touches the stored one', async () => {
      const ae = await setupShop('out-keep', 'United Arab Emirates');
      const path = `/outlets/${ae.outletId}`;
      await request(server())
        .patch(path)
        .set('Authorization', `Bearer ${ae.token}`)
        .send({ regionId: await regionId('AE-RK') })
        .expect(200);
      const after = body<OrderBody>(
        await request(server())
          .patch(path)
          .set('Authorization', `Bearer ${ae.token}`)
          .send({ name: 'Renamed outlet' })
          .expect(200),
      );
      expect(after.regionId).toBe(await regionId('AE-RK'));
    });
  });
});
