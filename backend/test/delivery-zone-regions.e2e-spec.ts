import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { PlatformAdminService } from '../src/platform-admin/platform-admin.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface ZoneBody {
  id: number;
  name: string;
  mappingConfirmedAt: string | null;
  regions: { id: number; code: string; nameEn: string }[];
}
interface Proposal {
  mode: 'legacy' | 'regions';
  unconfirmedActiveZones: number;
  zones: {
    zoneId: number;
    name: string;
    confirmed: boolean;
    current: string;
    currentRegions: { code: string }[];
    proposal: { regionIds: number[]; reason: string; confident: boolean };
  }[];
}
interface ErrorBody {
  message: string | string[];
}
function body<T>(res: Response): T {
  return res.body as T;
}

// Outlet centre. Pins at the centre are inside the outlet's own delivery radius.
const LAT = 25.2048;
const LNG = 55.2708;

// Phase 2b / PR-D. Delivery zones move from free-text names to region sets. A shop
// keeps the old name matching, with no fee changing, until a merchant has reviewed
// and confirmed EVERY active zone's regions; the review is the PUT .../mapping call.
describe('Delivery zone region mapping (e2e)', () => {
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

  async function setupShop(prefix: string, country = 'United Arab Emirates') {
    const slug = `${prefix}-${runId}`;
    const signup = await request(server())
      .post('/auth/signup')
      .send({
        name: 'Zone Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
        country,
      })
      .expect(201);
    const token = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      server(),
      body<AuthResponse>(signup).devVerificationLink,
    );
    const auth = { Authorization: `Bearer ${token}` };

    const outlets = await request(server())
      .get('/outlets')
      .set(auth)
      .expect(200);
    const outletId = body<IdRow[]>(outlets)[0].id;
    await request(server())
      .patch(`/outlets/${outletId}`)
      .set(auth)
      .send({
        active: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        latitude: LAT,
        longitude: LNG,
        deliveryRadiusKm: 5,
      })
      .expect(200);
    await request(server())
      .patch('/shop')
      .set(auth)
      .send({ defaultDeliveryFee: 15 })
      .expect(200);

    const collection = await request(server())
      .post('/collections')
      .set(auth)
      .send({ name: 'Zone Collection' })
      .expect(201);
    const product = await request(server())
      .post('/products')
      .set(auth)
      .send({
        name: 'Zone Rose',
        price: 20,
        thumbnail: 'https://example.com/z.jpg',
        sku: `ZONE-${slug}`,
        trackInventory: true,
        collectionIds: [body<IdRow>(collection).id],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;
    await request(server())
      .patch('/products/stock/bulk-adjust')
      .set(auth)
      .send({ outletId, adjustments: [{ productId, delta: 100 }] })
      .expect(200);
    await request(server())
      .patch('/shop')
      .set(auth)
      .send({ published: true })
      .expect(200);
    const shopRows = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return { slug, token, auth, outletId, productId, shopId: shopRows[0].id };
  }
  type Shop = Awaited<ReturnType<typeof setupShop>>;

  // A zone as the migration left every existing one: active, never reviewed. The
  // API now refuses to create such a zone in a shop with nothing to keep it company
  // (see the guard test), so the legacy state is seeded the way it really arose.
  async function legacyZone(
    s: Shop,
    name: string,
    fee: number,
    isActive = true,
  ) {
    const res = await db.execute(
      `INSERT INTO deliveryzone (outletId, name, fee, minOrderAmount, isActive) VALUES (?, ?, ?, 0, ?)`,
      [s.outletId, name, fee, isActive],
    );
    return {
      id: res.insertId,
      name,
      mappingConfirmedAt: null,
      regions: [],
    } as ZoneBody;
  }

  const zonesUrl = (s: Shop) => `/outlets/${s.outletId}/delivery-zones`;
  const createZone = (s: Shop, payload: Record<string, unknown>) =>
    request(server()).post(zonesUrl(s)).set(s.auth).send(payload);
  const proposal = async (s: Shop) =>
    body<Proposal>(
      await request(server())
        .get(`${zonesUrl(s)}/mapping-proposal`)
        .set(s.auth)
        .expect(200),
    );
  const confirm = (s: Shop, zoneId: number, regionIds: number[]) =>
    request(server())
      .put(`${zonesUrl(s)}/${zoneId}/mapping`)
      .set(s.auth)
      .send({ regionIds });

  async function feeFor(s: Shop, region: string | null) {
    const res = await request(server())
      .post(`/public/${s.slug}/orders`)
      .send({
        outletId: s.outletId,
        orderType: 'delivery',
        paymentMethod: 'cash_on_delivery',
        customerName: 'Zone Shopper',
        customerPhone: '0501234567',
        customerAddress: '1 Zone St',
        latitude: LAT,
        longitude: LNG,
        items: [{ productId: s.productId, quantity: 1 }],
        ...(region && { regionId: await regionId(region) }),
      })
      .expect(201);
    return Number(
      body<{ order: { deliveryFee: string } }>(res).order.deliveryFee,
    );
  }

  describe('the D-3 case: a zone named for several emirates', () => {
    it('charges the default fee while the shop is unmapped (the old behaviour), then the zone fee once a merchant confirms the regions', async () => {
      const s = await setupShop('dz-dxb');
      const zone = await legacyZone(s, 'DXB/SHJ/AJM', 30);
      expect(zone.mappingConfirmedAt).toBeNull();

      // Legacy: "DXB/SHJ/AJM" equals no emirate and no area, so it never matches.
      expect(await proposal(s)).toMatchObject({
        mode: 'legacy',
        unconfirmedActiveZones: 1,
      });
      expect(await feeFor(s, 'AE-SH')).toBe(15);

      const confirmed = body<ZoneBody>(
        await confirm(s, zone.id, [
          await regionId('AE-DU'),
          await regionId('AE-SH'),
          await regionId('AE-AJ'),
        ]).expect(200),
      );
      expect(confirmed.mappingConfirmedAt).not.toBeNull();
      expect(confirmed.regions.map((r) => r.code).sort()).toEqual([
        'AE-AJ',
        'AE-DU',
        'AE-SH',
      ]);

      expect(await proposal(s)).toMatchObject({
        mode: 'regions',
        unconfirmedActiveZones: 0,
      });
      expect(await feeFor(s, 'AE-SH')).toBe(30);
      expect(await feeFor(s, 'AE-DU')).toBe(30);
      expect(await feeFor(s, 'AE-AJ')).toBe(30);
      // A region outside the set matches no zone: same rule as before, default fee
      // (the outlet radius was already passed).
      expect(await feeFor(s, 'AE-FU')).toBe(15);
    });
  });

  describe('the review proposal', () => {
    it('proposes an exact region for exact names and flags "Dubai Full" as something to check', async () => {
      const s = await setupShop('dz-prop');
      await legacyZone(s, 'Dubai', 10);
      await legacyZone(s, 'Sharjah', 20);
      await legacyZone(s, 'Dubai Full', 25);
      await legacyZone(s, 'Marina', 12);
      const p = await proposal(s);
      const by = (name: string) => p.zones.find((z) => z.name === name)!;

      expect(by('Dubai').proposal).toMatchObject({
        regionIds: [await regionId('AE-DU')],
        reason: 'exact-name',
        confident: true,
      });
      expect(by('Sharjah').proposal).toMatchObject({
        regionIds: [await regionId('AE-SH')],
        reason: 'exact-name',
        confident: true,
      });
      // Not an exact match: proposed, but never confident.
      expect(by('Dubai Full').proposal).toMatchObject({
        regionIds: [await regionId('AE-DU')],
        reason: 'contains-name',
        confident: false,
      });
      expect(by('Marina').proposal).toMatchObject({
        regionIds: [],
        reason: 'none',
      });
      // Nothing is confirmed by merely asking for the proposal.
      expect(p.zones.every((z) => !z.confirmed)).toBe(true);
      expect(p.mode).toBe('legacy');
      expect(by('Dubai').current).toContain('whose emirate is Dubai');
    });
  });

  describe('when a shop flips to region matching', () => {
    it('only when EVERY active zone is confirmed; an inactive unconfirmed zone does not hold it back', async () => {
      const s = await setupShop('dz-flip');
      const a = await legacyZone(s, 'Dubai', 10);
      const b = await legacyZone(s, 'Sharjah', 20);
      await legacyZone(s, 'Old', 5, false);

      await confirm(s, a.id, [await regionId('AE-DU')]).expect(200);
      expect(await proposal(s)).toMatchObject({
        mode: 'legacy',
        unconfirmedActiveZones: 1,
      });
      // Still name matching: "Sharjah" matches by name and is charged, and Dubai
      // (confirmed, but mode is still legacy) also still matches by name.
      expect(await feeFor(s, 'AE-SH')).toBe(20);

      await confirm(s, b.id, [await regionId('AE-SH')]).expect(200);
      expect((await proposal(s)).mode).toBe('regions');
      expect(await feeFor(s, 'AE-SH')).toBe(20);
    });

    it('a shop with no active zones is in region mode: there is nothing to map', async () => {
      const s = await setupShop('dz-empty');
      expect(await proposal(s)).toMatchObject({
        mode: 'regions',
        unconfirmedActiveZones: 0,
      });
    });

    it('in region mode the zone NAME no longer matters: a zone named "Dubai" mapped to Sharjah serves Sharjah', async () => {
      const s = await setupShop('dz-name');
      const z = await legacyZone(s, 'Dubai', 44);
      await confirm(s, z.id, [await regionId('AE-SH')]).expect(200);
      expect(await feeFor(s, 'AE-SH')).toBe(44);
      expect(await feeFor(s, 'AE-DU')).toBe(15); // the name "Dubai" buys nothing
    });

    it('region mode cannot be dragged back: an unreviewed zone cannot be created or turned on', async () => {
      const s = await setupShop('dz-guard');
      const z = await legacyZone(s, 'Dubai', 10);
      await confirm(s, z.id, [await regionId('AE-DU')]).expect(200);
      expect((await proposal(s)).mode).toBe('regions');

      // A new zone with neither regions nor a placed circle is refused...
      const refused = await createZone(s, { name: 'Loose', fee: 9 }).expect(
        400,
      );
      expect(body<ErrorBody>(refused).message).toEqual(
        expect.stringContaining('Choose the regions'),
      );
      // ...one saved with regions is born confirmed...
      const born = body<ZoneBody>(
        await createZone(s, {
          name: 'Ajman',
          fee: 18,
          regionIds: [await regionId('AE-AJ')],
        }).expect(201),
      );
      expect(born.mappingConfirmedAt).not.toBeNull();
      expect((await proposal(s)).mode).toBe('regions');
      // ...and an old inactive unreviewed zone cannot be switched on unreviewed.
      await db.execute(
        `UPDATE deliveryzone SET isActive = 0, mappingConfirmedAt = NULL WHERE id = ?`,
        [born.id],
      );
      await request(server())
        .patch(`${zonesUrl(s)}/${born.id}`)
        .set(s.auth)
        .send({ isActive: true })
        .expect(409);
      expect((await proposal(s)).mode).toBe('regions');
    });
  });

  describe('validation and isolation', () => {
    it('refuses regions of another country, unknown ids, and an empty set with no placed circle', async () => {
      const s = await setupShop('dz-val');
      const z = await legacyZone(s, 'Dubai', 10);
      await confirm(s, z.id, [await regionId('SA-01')]).expect(400);
      await confirm(s, z.id, [999999999]).expect(400);
      const empty = await confirm(s, z.id, []).expect(400);
      expect(body<ErrorBody>(empty).message).toEqual(
        expect.stringContaining('at least one region, or a placed map circle'),
      );
      await createZone(s, {
        name: 'X',
        fee: 1,
        regionIds: [await regionId('SA-01')],
      }).expect(400);
      // Nothing was confirmed by any refused attempt.
      expect((await proposal(s)).zones.every((x) => !x.confirmed)).toBe(true);
    });

    it('an empty set is fine for a zone whose map circle is placed: it then matches by location', async () => {
      const s = await setupShop('dz-circle');
      const z = body<ZoneBody>(
        await createZone(s, {
          name: 'Marina Walk',
          fee: 40,
          lat: LAT,
          lng: LNG,
          radiusKm: 2,
        }).expect(201),
      );
      // Placing the circle at creation already counted as the merchant's decision.
      expect(z.mappingConfirmedAt).not.toBeNull();
      expect((await proposal(s)).mode).toBe('regions');
      // A pin inside its circle is served by it, whatever region the customer is in.
      expect(await feeFor(s, 'AE-FU')).toBe(40);
    });

    it("another shop's admin cannot read or change this shop's zones (404, not 403)", async () => {
      const a = await setupShop('dz-iso-a');
      const b = await setupShop('dz-iso-b');
      const z = await legacyZone(a, 'Dubai', 10);
      await request(server())
        .put(`/outlets/${a.outletId}/delivery-zones/${z.id}/mapping`)
        .set(b.auth)
        .send({ regionIds: [await regionId('AE-DU')] })
        .expect(404);
      await request(server())
        .get(`/outlets/${a.outletId}/delivery-zones/mapping-proposal`)
        .set(b.auth)
        .expect(404);
      // And a zone id from another outlet in the URL of your own outlet is a 404 too.
      await request(server())
        .put(`/outlets/${b.outletId}/delivery-zones/${z.id}/mapping`)
        .set(b.auth)
        .send({ regionIds: [await regionId('AE-DU')] })
        .expect(404);
      expect((await proposal(a)).zones[0].confirmed).toBe(false);
    });

    it('a confirmation leaves an audit-log row with the before and after region sets', async () => {
      const s = await setupShop('dz-audit');
      const z = await legacyZone(s, 'Dubai', 10);
      await confirm(s, z.id, [await regionId('AE-DU')]).expect(200);
      const rows = await db.query<
        ({
          after: { regionIds: number[]; confirmed: boolean };
        } & RowDataPacket)[]
      >(
        `SELECT \`after\` FROM auditlog WHERE shopId = ? AND action = 'delivery_zone.mapping_confirmed' AND entityId = ?`,
        [s.shopId, z.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].after).toEqual({
        regionIds: [await regionId('AE-DU')],
        confirmed: true,
      });
    });

    it('zone listing carries the region set and the confirmation', async () => {
      const s = await setupShop('dz-list');
      const z = await legacyZone(s, 'Dubai', 10);
      await confirm(s, z.id, [
        await regionId('AE-DU'),
        await regionId('AE-SH'),
      ]).expect(200);
      const list = body<ZoneBody[]>(
        await request(server()).get(zonesUrl(s)).set(s.auth).expect(200),
      );
      expect(list[0].regions.map((r) => r.code)).toEqual(
        ['AE-SH', 'AE-DU'].sort((x, y) => (x === 'AE-DU' ? -1 : 1)),
      );
      expect(list[0].mappingConfirmedAt).not.toBeNull();
    });
  });

  describe('platform admin gate for removing the legacy matcher', () => {
    it('lists exactly the shops still waiting on a merchant, and drops them once confirmed', async () => {
      const s = await setupShop('dz-gate');
      const z = await legacyZone(s, 'Dubai', 10);
      const svc = app.get(PlatformAdminService);
      const before = await svc.listLegacyZoneMappingShops();
      const mine = before.shops.find((x) => x.shopId === s.shopId);
      expect(mine).toEqual({
        shopId: s.shopId,
        subdomain: s.slug,
        unconfirmedActiveZones: 1,
      });
      await confirm(s, z.id, [await regionId('AE-DU')]).expect(200);
      const after = await svc.listLegacyZoneMappingShops();
      expect(after.shops.some((x) => x.shopId === s.shopId)).toBe(false);
    });
  });
});
