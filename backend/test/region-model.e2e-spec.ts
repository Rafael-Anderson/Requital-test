import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

interface AuthResponse {
  accessToken: string;
  user: { shopId: number };
}
interface IdRow {
  id: number;
}
function body<T>(res: Response): T {
  return res.body as T;
}

// Phase 2b / PR-A. The region tables and columns are schema only: nothing reads
// them yet. This spec pins (1) the seed, (2) the FKs, (3) shop.countryCode being
// written on signup and on the once-only PATCH, and (4) the backfill, by
// re-running the migration's own UPDATE statements against fixtures.
describe('Region model schema (e2e)', () => {
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
    db = moduleFixture.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string, country?: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Region Admin',
        email: `${prefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
        ...(country && { country }),
      })
      .expect(201);
    const { accessToken, user } = body<AuthResponse>(res);
    const outlets = await db.query<(IdRow & RowDataPacket)[]>(
      `SELECT id FROM outlet WHERE shopId = ? ORDER BY id LIMIT 1`,
      [user.shopId],
    );
    return { token: accessToken, shopId: user.shopId, outletId: outlets[0].id };
  }

  async function countryCodeOf(shopId: number) {
    const rows = await db.query<
      ({ countryCode: string | null } & RowDataPacket)[]
    >(`SELECT countryCode FROM shop WHERE id = ?`, [shopId]);
    return rows[0].countryCode;
  }

  describe('seed', () => {
    it.each([
      ['AE', 7],
      ['SA', 13],
      ['KW', 6],
      ['QA', 8],
      ['BH', 4],
      ['OM', 11],
    ])('%s has %i regions', async (countryCode, expected) => {
      const rows = await db.query<({ n: number } & RowDataPacket)[]>(
        `SELECT COUNT(*) AS n FROM region WHERE countryCode = ?`,
        [countryCode],
      );
      expect(Number(rows[0].n)).toBe(expected);
    });

    it('the seven emirates are exactly the names the old EMIRATES const held', async () => {
      const rows = await db.query<({ nameEn: string } & RowDataPacket)[]>(
        `SELECT nameEn FROM region WHERE countryCode = 'AE' ORDER BY sortOrder`,
      );
      expect(rows.map((r) => r.nameEn)).toEqual([
        'Abu Dhabi',
        'Dubai',
        'Sharjah',
        'Ajman',
        'Umm Al Quwain',
        'Ras Al Khaimah',
        'Fujairah',
      ]);
    });

    it('every region has an Arabic name and a unique code, none has a parent yet', async () => {
      const rows = await db.query<
        ({
          n: number;
          codes: number;
          blank: number;
          parented: number;
        } & RowDataPacket)[]
      >(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT code) AS codes,
                SUM(TRIM(nameAr) = '') AS blank,
                SUM(parentRegionId IS NOT NULL) AS parented
           FROM region`,
      );
      expect(Number(rows[0].codes)).toBe(Number(rows[0].n));
      expect(Number(rows[0].blank)).toBe(0);
      expect(Number(rows[0].parented)).toBe(0);
    });

    it('Arabic survives the round trip byte for byte', async () => {
      const rows = await db.query<({ nameAr: string } & RowDataPacket)[]>(
        `SELECT nameAr FROM region WHERE code = 'AE-DU'`,
      );
      expect(rows[0].nameAr).toBe('دبي');
    });
  });

  describe('foreign keys', () => {
    it('a region referenced by an outlet cannot be deleted (ON DELETE RESTRICT)', async () => {
      const shop = await setupShop('region-fk', 'United Arab Emirates');
      const [dubai] = await db.query<(IdRow & RowDataPacket)[]>(
        `SELECT id FROM region WHERE code = 'AE-DU'`,
      );
      await db.execute(`UPDATE outlet SET regionId = ? WHERE id = ?`, [
        dubai.id,
        shop.outletId,
      ]);
      await expect(
        db.execute(`DELETE FROM region WHERE id = ?`, [dubai.id]),
      ).rejects.toMatchObject({ errno: 1451 });
    });

    it('deleting a zone removes its region memberships, never the region', async () => {
      const shop = await setupShop('region-zone-fk', 'United Arab Emirates');
      const zone = await db.execute(
        `INSERT INTO deliveryzone (outletId, name, fee) VALUES (?, 'Fixture', 10)`,
        [shop.outletId],
      );
      const [sharjah] = await db.query<(IdRow & RowDataPacket)[]>(
        `SELECT id FROM region WHERE code = 'AE-SH'`,
      );
      await db.execute(
        `INSERT INTO deliveryzoneregion (zoneId, regionId) VALUES (?, ?)`,
        [zone.insertId, sharjah.id],
      );
      await db.execute(`DELETE FROM deliveryzone WHERE id = ?`, [
        zone.insertId,
      ]);
      const left = await db.query<({ n: number } & RowDataPacket)[]>(
        `SELECT COUNT(*) AS n FROM deliveryzoneregion WHERE zoneId = ?`,
        [zone.insertId],
      );
      expect(Number(left[0].n)).toBe(0);
      const still = await db.query<RowDataPacket[]>(
        `SELECT id FROM region WHERE id = ?`,
        [sharjah.id],
      );
      expect(still).toHaveLength(1);
    });
  });

  describe('shop.countryCode', () => {
    it.each([
      ['United Arab Emirates', 'AE'],
      ['Saudi Arabia', 'SA'],
      ['Kuwait', 'KW'],
      ['Qatar', 'QA'],
      ['Bahrain', 'BH'],
      ['Oman', 'OM'],
    ])('signup with %s stores %s', async (country, code) => {
      const shop = await setupShop(`cc-${code.toLowerCase()}`, country);
      expect(await countryCodeOf(shop.shopId)).toBe(code);
    });

    it('"Other", an unrecognised string and no country all store NULL, never a guess', async () => {
      const other = await setupShop('cc-other', 'Other');
      const odd = await setupShop('cc-odd', 'constructor');
      const none = await setupShop('cc-none');
      expect(await countryCodeOf(other.shopId)).toBeNull();
      expect(await countryCodeOf(odd.shopId)).toBeNull();
      expect(await countryCodeOf(none.shopId)).toBeNull();
    });

    it('the once-only PATCH /shop country sets the code too', async () => {
      const shop = await setupShop('cc-patch');
      expect(await countryCodeOf(shop.shopId)).toBeNull();
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.token}`)
        .send({ country: 'Qatar' })
        .expect(200);
      expect(await countryCodeOf(shop.shopId)).toBe('QA');
    });
  });

  describe('backfill (the migration own UPDATE statements, re-run on fixtures)', () => {
    // Pulled out of the migration file itself, so this tests what production
    // runs rather than a copy of it that could drift.
    const backfillStatements = readFileSync(
      join(
        __dirname,
        '..',
        'prisma',
        'migrations',
        '20261001110000_region_columns_and_backfill',
        'migration.sql',
      ),
      'utf8',
    )
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => /^UPDATE `(order|draftorder|outlet)`/.test(s));

    async function insertOrder(
      shop: { shopId: number; outletId: number },
      n: number,
      emirate: string,
    ) {
      const r = await db.execute(
        `INSERT INTO \`order\` (shopId, outletId, shopOrderNumber, customerName, customerPhone, customerAddress, emirate, total, currency)
         VALUES (?, ?, ?, 'Fixture', '0501234567', '1 Fixture St', ?, 10, 'AED')`,
        [shop.shopId, shop.outletId, n, emirate],
      );
      return r.insertId;
    }
    async function insertDraft(
      shop: { shopId: number; outletId: number },
      emirate: string | null,
    ) {
      const r = await db.execute(
        `INSERT INTO draftorder (shopId, outletId, customerName, customerPhone, emirate, currency, updatedAt)
         VALUES (?, ?, 'Fixture', '0501234567', ?, 'AED', NOW(3))`,
        [shop.shopId, shop.outletId, emirate],
      );
      return r.insertId;
    }
    async function regionOf(table: string, id: number) {
      const rows = await db.query<({ code: string | null } & RowDataPacket)[]>(
        `SELECT r.code FROM \`${table}\` t LEFT JOIN region r ON r.id = t.regionId WHERE t.id = ?`,
        [id],
      );
      return rows[0].code;
    }
    async function runBackfill() {
      for (const sql of backfillStatements) await db.execute(sql);
    }

    it('extracted exactly the three UPDATE statements', () => {
      expect(backfillStatements).toHaveLength(3);
    });

    it('maps every shape it should, leaves every shape it should not, and a re-run changes nothing', async () => {
      const uae = await setupShop('bf-uae', 'United Arab Emirates');
      const sa = await setupShop('bf-sa', 'Saudi Arabia');
      const noCountry = await setupShop('bf-none');

      const exact = await insertOrder(uae, 1, 'Dubai');
      const spaced = await insertOrder(uae, 2, '  Sharjah ');
      const cased = await insertOrder(uae, 3, 'ABU DHABI');
      const typo = await insertOrder(uae, 4, 'Dubay');
      // A UAE emirate on a Saudi shop must NOT map: Saudi Arabia has no Dubai.
      const wrongCountry = await insertOrder(sa, 1, 'Dubai');
      // No countryCode means unknown; it must not be assumed to be the UAE.
      const unknownCountry = await insertOrder(noCountry, 1, 'Dubai');
      const draftOk = await insertDraft(uae, 'Fujairah');
      const draftNull = await insertDraft(uae, null);

      await db.execute(`UPDATE outlet SET emirate = 'Ajman' WHERE id = ?`, [
        uae.outletId,
      ]);
      await db.execute(`UPDATE outlet SET emirate = NULL WHERE id = ?`, [
        noCountry.outletId,
      ]);

      await runBackfill();

      expect(await regionOf('order', exact)).toBe('AE-DU');
      expect(await regionOf('order', spaced)).toBe('AE-SH');
      expect(await regionOf('order', cased)).toBe('AE-AZ');
      expect(await regionOf('order', typo)).toBeNull();
      expect(await regionOf('order', wrongCountry)).toBeNull();
      expect(await regionOf('order', unknownCountry)).toBeNull();
      expect(await regionOf('draftorder', draftOk)).toBe('AE-FU');
      expect(await regionOf('draftorder', draftNull)).toBeNull();
      expect(await regionOf('outlet', uae.outletId)).toBe('AE-AJ');
      expect(await regionOf('outlet', noCountry.outletId)).toBeNull();

      // Idempotent: a second pass neither throws nor moves anything.
      await runBackfill();
      expect(await regionOf('order', exact)).toBe('AE-DU');
      expect(await regionOf('order', typo)).toBeNull();
    });
  });
});
