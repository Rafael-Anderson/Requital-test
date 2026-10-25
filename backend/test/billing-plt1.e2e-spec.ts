import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createConnection } from 'mysql2/promise';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { FeaturesService } from '../src/features/features.service';
import { FEATURE_KEYS, FEATURE_KEY_LIST } from '../src/features/feature-keys';
import { PlatformAuditLogService } from '../src/platform-admin/platform-audit-log.service';
import { currentUsagePeriod } from '../src/billing/usage-period';
import { createStaffToken } from './helpers/staff-login';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface Sub {
  hasSubscription: boolean;
  status: string | null;
  source: string | null;
  plan: { code: string; kind: string; orderSoftCeiling: number | null } | null;
  features: { key: string; entitled: boolean }[];
}
interface Usage {
  periodKey: string;
  used: number;
  ceiling: number | null;
  percent: number | null;
  level: number;
}
interface ShopBilling {
  subscription: Sub;
  usage: Usage;
  suspension: { suspendedAt: string | null; reason: string | null };
  events: { reason: string; actorType: string }[];
}

const body = <T>(res: Response) => res.body as T;
const ph = (a: number[]) => a.map(() => '?').join(',');
const BILLING_TABLES = [
  'plan',
  'planfeature',
  'planprice',
  'shopsubscription',
  'subscriptionevent',
];

function extractCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.get('Set-Cookie') ?? []) {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

describe('Billing PLT-1 first slice (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let features: FeaturesService;
  const runId = Date.now();
  let platformCookie: string;
  let platformCsrf: string;

  const tenants: Record<
    'A' | 'B',
    { id: number; slug: string; token: string; outletId: number; productId: number }
  > = {
    A: { id: 0, slug: '', token: '', outletId: 0, productId: 0 },
    B: { id: 0, slug: '', token: '', outletId: 0, productId: 0 },
  };

  async function signup(tag: 'A' | 'B') {
    const slug = `bill-${tag.toLowerCase()}-${runId}`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: `Billing ${tag}`,
        email: `billing-${tag}-${runId}@test.com`,
        password: 'password123',
        shopName: `Billing ${tag}`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(res).accessToken;
    await verifySignupEmail(app.getHttpServer(), body<AuthResponse>(res).devVerificationLink);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const outletId = body<{ id: number }[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        active: true,
        deliveryEnabled: true,
        pickupEnabled: true,
        latitude: 25.2048,
        longitude: 55.2708,
        deliveryRadiusKm: 5,
      })
      .expect(200);
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'General' })
      .expect(201);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Billing Product ${tag}`,
        price: 10,
        thumbnail: 'https://example.com/x.jpg',
        sku: `BILL-${tag}-${runId}`,
        trackInventory: true,
        collectionIds: [body<{ id: number }>(collection).id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/products/stock/bulk-adjust')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId,
        adjustments: [{ productId: body<{ id: number }>(product).id, delta: 100 }],
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${token}`)
      .send({ published: true })
      .expect(200);
    tenants[tag] = {
      id: body<{ shopId: number }>(me).shopId,
      slug,
      token,
      outletId,
      productId: body<{ id: number }>(product).id,
    };
  }

  const auth = (t: 'A' | 'B') => ({ Authorization: `Bearer ${tenants[t].token}` });
  const platformGet = (path: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', platformCookie);
  const platformPost = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', platformCookie)
      .set('X-CSRF-Token', platformCsrf);

  // A shop made by SQL only (no subscription row, like one created by the
  // pre-billing backend), with a distinct flag pattern, a few orders and an
  // optional override / suspension.
  async function fixtureShop(i: number): Promise<number> {
    const r = await db.execute(
      `INSERT INTO shop (name, subdomain, sliderEnabled, customerSurveyEnabled, notifyEmail,
         notifyCustomersWhatsapp, notifyAbandonedCart, notifyLowStockDigest,
         autoDeductIngredientStock, whatsappFloatingButtonEnabled, productImageZoomEnabled,
         showCollectionMenu, suspendedAt, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Fx ${runId} ${i}`,
        `bfx-${i}-${runId}`,
        i & 1,
        (i >> 1) & 1,
        (i >> 2) & 1,
        (i >> 3) & 1,
        (i >> 4) & 1,
        (i + 1) & 1,
        ((i >> 1) & 1) ^ 1,
        (i >> 2) & 1,
        ((i >> 3) & 1) ^ 1,
        ((i >> 4) & 1) ^ 1,
        i % 7 === 0 ? new Date() : null,
        ['AED', 'KWD', 'SAR'][i % 3],
      ],
    );
    const shopId = r.insertId;
    const o = await db.execute(`INSERT INTO outlet (shopId, name) VALUES (?, 'Main')`, [shopId]);
    if (i % 2 === 0) {
      await db.execute(
        `INSERT INTO \`order\` (shopId, outletId, shopOrderNumber, currency, customerName,
           customerPhone, customerAddress, total, status)
         VALUES (?, ?, 1, 'KWD', 'A', '0501', 'x', 10.505, 'pending'),
                (?, ?, 2, 'KWD', 'B', '0502', 'x', 20, 'cancelled')`,
        [shopId, o.insertId, shopId, o.insertId],
      );
    }
    if (i % 5 === 0) {
      await db.execute(
        `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'slider', ?), (?, 'marketplace_channels', 1)`,
        [shopId, i % 2, shopId],
      );
    }
    return shopId;
  }

  // The pre-billing formula, restated independently of the code under test.
  async function oracleFlags(shopId: number): Promise<Record<string, boolean>> {
    const [shop] = await db.query<RowDataPacket[]>(`SELECT * FROM shop WHERE id = ?`, [shopId]);
    const ov = await db.query<RowDataPacket[]>(
      `SELECT featureKey, enabled FROM shopfeatureoverride WHERE shopId = ?`,
      [shopId],
    );
    const o = new Map(ov.map((r) => [r.featureKey as string, Boolean(r.enabled)]));
    const out: Record<string, boolean> = {};
    for (const k of FEATURE_KEY_LIST) {
      const d = FEATURE_KEYS[k];
      const col = d.source === 'column' ? shop[d.column] : null;
      out[k] = o.has(k) ? o.get(k)! : col != null ? Boolean(col) : d.default;
    }
    return out;
  }

  const SHOP_COLS =
    'id,name,subdomain,currency,published,suspendedAt,sliderEnabled,customerSurveyEnabled,notifyEmail,notifyCustomersWhatsapp,notifyAbandonedCart,notifyLowStockDigest,autoDeductIngredientStock,whatsappFloatingButtonEnabled,productImageZoomEnabled,showCollectionMenu'.split(
      ',',
    );
  const ORDER_COLS = 'id,shopId,outletId,shopOrderNumber,currency,total,status,createdAt'.split(',');
  const rowHash = (cols: string[]) =>
    `CAST(CONV(SUBSTRING(MD5(CONCAT_WS('|', ${cols.map((c) => `IFNULL(\`${c}\`, '~NULL~')`).join(', ')})), 1, 16), 16, 10) AS UNSIGNED)`;
  async function checksum(table: string, cols: string[], where: string, ids: number[]) {
    const [r] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n, CAST(BIT_XOR(${rowHash(cols)}) AS CHAR) AS x FROM \`${table}\` WHERE ${where} IN (${ph(ids)})`,
      ids,
    );
    return `${r.n}:${r.x}`;
  }

  async function runMigrationSql() {
    const sql = readFileSync(
      join(__dirname, '../prisma/migrations/20261124110000_billing_plt1_seed_backfill/migration.sql'),
      'utf8',
    );
    const conn = await createConnection({
      uri: process.env.DATABASE_URL,
      multipleStatements: true,
    });
    try {
      await conn.query(sql);
    } finally {
      await conn.end();
    }
  }

  async function count(table: string): Promise<number> {
    const [r] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return Number(r.n);
  }

  async function insertOrders(
    shopId: number,
    outletId: number,
    specs: { at: Date; status: string }[],
  ) {
    for (const [i, s] of specs.entries()) {
      await db.execute(
        `INSERT INTO \`order\` (shopId, outletId, shopOrderNumber, currency, customerName,
           customerPhone, customerAddress, total, status, createdAt)
         VALUES (?, ?, ?, 'AED', 'U', '0500', 'x', 10, ?, ?)`,
        [shopId, outletId, 900000 + Math.floor(Math.random() * 90000) + i, s.status, s.at],
      );
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DatabaseService);
    features = app.get(FeaturesService);

    await signup('A');
    await signup('B');

    const email = `billing-platform-${runId}@test.com`;
    await db.execute(`INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`, [
      email,
      await bcrypt.hash('platform-password-123', 10),
      'Billing Platform Admin',
    ]);
    const login = await request(app.getHttpServer())
      .post('/platform-auth/login')
      .send({ email, password: 'platform-password-123' })
      .expect(201);
    const cookies = extractCookies(login);
    platformCookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    platformCsrf = cookies['req-platform-csrf'];
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('seed data', () => {
    it('has the legacy plan and three working-name tiers, with NO price anywhere', async () => {
      const plans = await db.query<RowDataPacket[]>(
        `SELECT code, kind, isSelectable, orderSoftCeiling FROM plan ORDER BY sortOrder`,
      );
      expect(plans.map((p) => p.code)).toEqual(['legacy_free', 'tier1', 'tier2', 'tier3']);
      expect(plans[0]).toMatchObject({ kind: 'legacy', isSelectable: false, orderSoftCeiling: null });
      expect(await count('planprice')).toBe(0);
    });

    it('every plan has a planfeature row for EVERY registered key (a key added without one fails here)', async () => {
      const plans = await db.query<RowDataPacket[]>(`SELECT id, code FROM plan`);
      for (const p of plans) {
        const rows = await db.query<RowDataPacket[]>(
          `SELECT featureKey FROM planfeature WHERE planId = ?`,
          [p.id],
        );
        const have = rows.map((r) => r.featureKey as string).sort();
        expect([p.code, have]).toEqual([p.code, [...FEATURE_KEY_LIST].sort()]);
      }
    });

    it('legacy entitles everything; auto_deduct_ingredient_stock is entitled on EVERY plan; tiers follow section 7.2', async () => {
      const ent = async (code: string) => {
        const rows = await db.query<RowDataPacket[]>(
          `SELECT pf.featureKey, pf.entitled FROM planfeature pf JOIN plan p ON p.id = pf.planId WHERE p.code = ?`,
          [code],
        );
        return new Map(rows.map((r) => [r.featureKey as string, Boolean(r.entitled)]));
      };
      const [legacy, t1, t2, t3] = await Promise.all(
        ['legacy_free', 'tier1', 'tier2', 'tier3'].map(ent),
      );
      for (const m of [legacy, t1, t2, t3]) expect(m.get('auto_deduct_ingredient_stock')).toBe(true);
      expect([...legacy.values()].every(Boolean)).toBe(true);
      expect([t1.get('slider'), t1.get('customer_survey'), t1.get('abandoned_cart_recovery')]).toEqual([
        false,
        false,
        false,
      ]);
      expect([t2.get('slider'), t2.get('customer_survey'), t2.get('abandoned_cart_recovery')]).toEqual([
        true,
        true,
        true,
      ]);
      expect([t2.get('notify_customers_whatsapp'), t3.get('notify_customers_whatsapp')]).toEqual([
        false,
        true,
      ]);
      expect([...t3.values()].every(Boolean)).toBe(true);
    });
  });

  describe('backfill changes nothing and is idempotent', () => {
    it('same flag matrix, same shop/order/override checksums, one legacy row per shop, re-run adds nothing', async () => {
      const ids: number[] = [];
      for (let i = 1; i <= 12; i++) ids.push(await fixtureShop(i));
      ids.push(tenants.A.id, tenants.B.id);
      // Created after the migration ran: no subscription row (fail open).
      await db.execute(`DELETE FROM shopsubscription WHERE shopId IN (${ph(ids)})`, ids);

      const matrix = async () =>
        Object.fromEntries(
          await Promise.all(ids.map(async (id) => [id, await features.getFlags(id)] as const)),
        );
      const sums = async () => [
        await checksum('shop', SHOP_COLS, 'id', ids),
        await checksum('order', ORDER_COLS, 'shopId', ids),
        await checksum('shopfeatureoverride', ['shopId', 'featureKey', 'enabled', 'note'], 'shopId', ids),
      ];

      const before = await matrix();
      const sumsBefore = await sums();
      // Fail-open already equals the independent pre-billing formula.
      for (const id of ids) expect(before[id]).toEqual(await oracleFlags(id));
      expect(
        (await db.query<RowDataPacket[]>(`SELECT shopId FROM shopsubscription WHERE shopId IN (${ph(ids)})`, ids)),
      ).toHaveLength(0);

      await runMigrationSql();

      expect(await matrix()).toEqual(before);
      expect(await sums()).toEqual(sumsBefore);
      const subs = await db.query<RowDataPacket[]>(
        `SELECT ss.shopId, ss.source, ss.status, ss.currency, ss.currentPeriodEnd, ss.trialEndsAt, p.code
           FROM shopsubscription ss JOIN plan p ON p.id = ss.planId WHERE ss.shopId IN (${ph(ids)})`,
        ids,
      );
      expect(subs).toHaveLength(ids.length);
      for (const s of subs) {
        expect(s).toMatchObject({ code: 'legacy_free', source: 'legacy', status: 'active' });
        // unknown stays NULL
        expect([s.currency, s.currentPeriodEnd, s.trialEndsAt]).toEqual([null, null, null]);
      }
      // Suspended-before-billing shops are 'platform', never auto-liftable.
      const suspended = await db.query<RowDataPacket[]>(
        `SELECT suspensionReason FROM shop WHERE id IN (${ph(ids)}) AND suspendedAt IS NOT NULL`,
        ids,
      );
      expect(suspended.length).toBeGreaterThan(0);
      for (const s of suspended) expect(s.suspensionReason).toBe('platform');

      // Idempotent: a second and third run add no row to any billing table.
      const sizes = async () => Promise.all(BILLING_TABLES.map(count));
      const mine = async () =>
        (await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM subscriptionevent WHERE shopId IN (${ph(ids)})`, ids))[0].n;
      await runMigrationSql(); // settle rows created by parallel specs
      const sizeBefore = await sizes();
      const eventsBefore = await mine();
      await runMigrationSql();
      await runMigrationSql();
      expect(await mine()).toBe(eventsBefore);
      expect(eventsBefore).toBe(ids.length);
      // plan / planfeature / planprice never change on a re-run
      expect((await sizes()).slice(0, 3)).toEqual(sizeBefore.slice(0, 3));
      expect(await matrix()).toEqual(before);
    }, 120_000);
  });

  describe('entitlement ceiling in FeaturesService', () => {
    let planId: number;
    let shopId: number;

    beforeAll(async () => {
      // A throwaway plan so the seeded plans are never mutated (other specs run
      // against the same DB): it carries a row for slider (off) and for
      // notify_email (on) only, and a ceiling of 2 orders.
      const p = await db.execute(
        `INSERT INTO plan (code, name, kind, orderSoftCeiling) VALUES (?, 'Test', 'standard', 2)`,
        [`t-${runId}`],
      );
      planId = p.insertId;
      await db.execute(
        `INSERT INTO planfeature (planId, featureKey, entitled) VALUES (?, 'slider', 0), (?, 'notify_email', 1)`,
        [planId, planId],
      );
      shopId = await fixtureShop(1000 + (runId % 1000));
      await db.execute(
        `UPDATE shop SET sliderEnabled = 1, notifyEmail = 1, customerSurveyEnabled = 1, suspendedAt = NULL WHERE id = ?`,
        [shopId],
      );
      await db.execute(`DELETE FROM shopfeatureoverride WHERE shopId = ?`, [shopId]);
      await db.execute(
        `INSERT INTO shopsubscription (shopId, planId, status, source) VALUES (?, ?, 'active', 'stripe')
         ON DUPLICATE KEY UPDATE planId = VALUES(planId), source = 'stripe'`,
        [shopId, planId],
      );
    });

    afterAll(async () => {
      await db.execute(`DELETE FROM shopsubscription WHERE planId = ?`, [planId]);
      await db.execute(`DELETE FROM plan WHERE id = ?`, [planId]);
    });

    it('an unentitled key is off even though the merchant switched it on; a key with no plan row fails open', async () => {
      const flags = await features.getFlags(shopId);
      expect(flags.slider).toBe(false); // plan row says no
      expect(flags.notify_email).toBe(true);
      expect(flags.customer_survey).toBe(true); // no planfeature row: entitled
      const [col] = await db.query<RowDataPacket[]>(`SELECT sliderEnabled FROM shop WHERE id = ?`, [shopId]);
      expect(Boolean(col.sliderEnabled)).toBe(true); // the merchant's column is never rewritten
      const d = (await features.describe(shopId))!;
      expect(d.find((f) => f.key === 'slider')).toMatchObject({ entitled: false, entitledBy: 'plan', effective: false });
      expect(d.find((f) => f.key === 'customer_survey')).toMatchObject({ entitled: true, entitledBy: 'default' });
    });

    it('a platform override beats the plan in both directions', async () => {
      await db.execute(
        `INSERT INTO shopfeatureoverride (shopId, featureKey, enabled) VALUES (?, 'slider', 1), (?, 'notify_email', 0)`,
        [shopId, shopId],
      );
      const flags = await features.getFlags(shopId);
      expect([flags.slider, flags.notify_email]).toEqual([true, false]);
      await db.execute(`DELETE FROM shopfeatureoverride WHERE shopId = ?`, [shopId]);
    });

    it('enabledShopIds (SQL) agrees with getFlags for every key, for plan-limited and plan-less shops', async () => {
      const bare = await fixtureShop(2000 + (runId % 1000)); // no subscription row
      const legacyShop = tenants.B.id;
      for (const key of FEATURE_KEY_LIST) {
        const ids = new Set(await features.enabledShopIds(key));
        for (const id of [shopId, bare, legacyShop]) {
          expect([key, id, ids.has(id)]).toEqual([key, id, (await features.getFlags(id))[key]]);
        }
      }
      expect(new Set(await features.enabledShopIds('slider')).has(shopId)).toBe(false);
    });

    it('moving the shop to a plan that entitles the key restores it with no reconfiguration', async () => {
      const [t2] = await db.query<RowDataPacket[]>(`SELECT id FROM plan WHERE code = 'tier2'`);
      await db.execute(`UPDATE shopsubscription SET planId = ? WHERE shopId = ?`, [t2.id, shopId]);
      expect((await features.getFlags(shopId)).slider).toBe(true);
      expect(new Set(await features.enabledShopIds('slider')).has(shopId)).toBe(true);
    });
  });

  describe('GET /billing/subscription and /billing/usage (shop admin, read only)', () => {
    it('a shop with no subscription row is reported honestly and keeps every feature (fail open)', async () => {
      await db.execute(`DELETE FROM shopsubscription WHERE shopId = ?`, [tenants.A.id]);
      const sub = body<Sub>(
        await request(app.getHttpServer()).get('/billing/subscription').set(auth('A')).expect(200),
      );
      expect(sub).toMatchObject({ hasSubscription: false, plan: null, status: null });
      expect(sub.features).toHaveLength(FEATURE_KEY_LIST.length);
      expect(sub.features.every((f) => f.entitled)).toBe(true);
      const usage = body<Usage>(
        await request(app.getHttpServer()).get('/billing/usage').set(auth('A')).expect(200),
      );
      expect(usage).toMatchObject({ used: 0, ceiling: null, percent: null, level: 0 });
    });

    it('shows the legacy plan once backfilled', async () => {
      await runMigrationSql();
      const sub = body<Sub>(
        await request(app.getHttpServer()).get('/billing/subscription').set(auth('A')).expect(200),
      );
      expect(sub).toMatchObject({
        hasSubscription: true,
        status: 'active',
        source: 'legacy',
        plan: { code: 'legacy_free', kind: 'legacy', orderSoftCeiling: null },
      });
    });

    it('is admin only and needs a login', async () => {
      await request(app.getHttpServer()).get('/billing/usage').expect(401);
      await request(app.getHttpServer()).get('/billing/subscription').expect(401);
      for (const role of ['viewer', 'order_manager'] as const) {
        const t = await createStaffToken(app, tenants.A.token, 'bill', role);
        await request(app.getHttpServer())
          .get('/billing/usage')
          .set('Authorization', `Bearer ${t}`)
          .expect(403);
        await request(app.getHttpServer())
          .get('/billing/subscription')
          .set('Authorization', `Bearer ${t}`)
          .expect(403);
      }
    });

    it('counts only this shop, only this month (shop timezone), only non-cancelled orders', async () => {
      const [tz] = await db.query<RowDataPacket[]>(`SELECT timezone FROM shop WHERE id = ?`, [tenants.A.id]);
      const period = currentUsagePeriod(new Date(), tz.timezone as string);
      const inMonth = new Date(Math.min(Date.now(), period.endExclusive.getTime() - 60_000));
      await insertOrders(tenants.A.id, tenants.A.outletId, [
        { at: inMonth, status: 'pending' },
        { at: inMonth, status: 'confirmed' },
        { at: inMonth, status: 'cancelled' }, // not counted
        { at: new Date(period.start.getTime() - 3_600_000), status: 'pending' }, // last month
        { at: period.endExclusive, status: 'pending' }, // next month (exclusive end)
      ]);
      await insertOrders(tenants.B.id, tenants.B.outletId, [{ at: inMonth, status: 'pending' }]);
      const a = body<Usage>(await request(app.getHttpServer()).get('/billing/usage').set(auth('A')).expect(200));
      const b = body<Usage>(await request(app.getHttpServer()).get('/billing/usage').set(auth('B')).expect(200));
      expect(a.used).toBe(2);
      expect(a.periodKey).toBe(period.periodKey);
      expect(b.used).toBe(1); // never A's orders
    });

    it('reports the plan ceiling and the soft level without blocking anything', async () => {
      // Throwaway plan with a ceiling of 1: A has 2 non-cancelled orders = 200%.
      const p = await db.execute(
        `INSERT INTO plan (code, name, kind, orderSoftCeiling) VALUES (?, 'Cap', 'standard', 1)`,
        [`cap-${runId}`],
      );
      await db.execute(`UPDATE shopsubscription SET planId = ? WHERE shopId = ?`, [p.insertId, tenants.A.id]);
      try {
        const u = body<Usage>(await request(app.getHttpServer()).get('/billing/usage').set(auth('A')).expect(200));
        expect(u).toMatchObject({ used: 2, ceiling: 1, percent: 200, level: 120 });
        // Over 120%, checkout and admin order creation still succeed.
        await request(app.getHttpServer())
          .post(`/public/${tenants.A.slug}/orders`)
          .send({
            outletId: tenants.A.outletId,
            orderType: 'delivery',
            latitude: 25.2048,
            longitude: 55.2708,
            customerName: 'Over Ceiling',
            customerPhone: '0501112222',
            customerAddress: 'x',
            paymentMethod: 'cash_on_delivery',
            items: [{ productId: tenants.A.productId, quantity: 1 }],
          })
          .then((r) =>
            expect({ status: r.status, body: r.status === 201 ? 'ok' : r.body }).toEqual({
              status: 201,
              body: 'ok',
            }),
          );
        await request(app.getHttpServer())
          .post('/orders')
          .set(auth('A'))
          .send({
            customerName: 'Admin Over',
            customerPhone: '0501113333',
            customerAddress: 'x',
            orderType: 'pickup',
            outletId: tenants.A.outletId,
            items: [{ productId: tenants.A.productId, quantity: 1 }],
          })
          .expect(201);
      } finally {
        const [legacy] = await db.query<RowDataPacket[]>(`SELECT id FROM plan WHERE code = 'legacy_free'`);
        await db.execute(`UPDATE shopsubscription SET planId = ? WHERE shopId = ?`, [legacy.id, tenants.A.id]);
        await db.execute(`DELETE FROM plan WHERE id = ?`, [p.insertId]);
      }
    });

    it('exposes no write route and no whitelisted billing field to a shop admin', async () => {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        await request(app.getHttpServer())[method]('/billing/subscription').set(auth('A')).send({}).expect(404);
        await request(app.getHttpServer())[method]('/billing/usage').set(auth('A')).send({}).expect(404);
      }
      for (const field of ['suspensionReason', 'planId', 'subscription']) {
        await request(app.getHttpServer())
          .patch('/shop')
          .set(auth('A'))
          .send({ [field]: 'platform' })
          .expect(400);
      }
      const [r] = await db.query<RowDataPacket[]>(`SELECT suspensionReason FROM shop WHERE id = ?`, [tenants.A.id]);
      expect(r.suspensionReason).toBeNull();
    });
  });

  describe('order creation does not touch billing', () => {
    it('issues no write to, and no plan / price / event read of, a billing table (entitlement SELECT through FeaturesService only)', async () => {
      const seen: string[] = [];
      const record = (sql: unknown) => {
        if (typeof sql === 'string') seen.push(sql);
      };
      const spies = (['query', 'execute'] as const).map((m) => {
        const orig = db[m].bind(db) as (...a: unknown[]) => Promise<unknown>;
        return jest.spyOn(db, m).mockImplementation(((sql: string, ...rest: unknown[]) => {
          record(sql);
          return orig(sql, ...rest);
        }) as never);
      });
      const origTx = db.transaction.bind(db);
      const txSpy = jest.spyOn(db, 'transaction').mockImplementation((async (
        fn: (conn: PoolConnection) => Promise<unknown>,
      ) =>
        origTx((conn: PoolConnection) =>
          fn(
            new Proxy(conn, {
              get(target, prop, receiver) {
                const v = Reflect.get(target, prop, receiver) as unknown;
                if ((prop === 'query' || prop === 'execute') && typeof v === 'function') {
                  return (sql: unknown, ...rest: unknown[]) => {
                    record(sql);
                    return (v as (...a: unknown[]) => unknown).call(target, sql, ...rest);
                  };
                }
                return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
              },
            }),
          ),
        )) as never);
      try {
        await request(app.getHttpServer())
          .post(`/public/${tenants.B.slug}/orders`)
          .send({
            outletId: tenants.B.outletId,
            orderType: 'delivery',
            latitude: 25.2048,
            longitude: 55.2708,
            customerName: 'Guard',
            customerPhone: '0501114444',
            customerAddress: 'x',
            paymentMethod: 'cash_on_delivery',
            items: [{ productId: tenants.B.productId, quantity: 1 }],
          })
          .then((r) =>
            expect({ status: r.status, body: r.status === 201 ? 'ok' : r.body }).toEqual({
              status: 201,
              body: 'ok',
            }),
          );
        await request(app.getHttpServer())
          .post('/orders')
          .set(auth('B'))
          .send({
            customerName: 'Guard Admin',
            customerPhone: '0501115555',
            customerAddress: 'x',
            orderType: 'pickup',
            outletId: tenants.B.outletId,
            items: [{ productId: tenants.B.productId, quantity: 1 }],
          })
          .expect(201);
      } finally {
        for (const s of spies) s.mockRestore();
        txSpy.mockRestore();
      }
      expect(seen.length).toBeGreaterThan(10); // the recorder really saw the flow
      const touching = seen.filter((s) => /\b(plan|planfeature|planprice|shopsubscription|subscriptionevent)\b/i.test(s));
      const bad = touching.filter(
        (s) =>
          /\b(INSERT|UPDATE|DELETE|REPLACE)\b[^;]*\b(plan|planfeature|planprice|shopsubscription|subscriptionevent)\b/i.test(s) ||
          /\b(FROM|JOIN)\s+`?(plan|planprice|subscriptionevent)\b/i.test(s) ||
          // the ONLY allowed read: FeaturesService's entitlement lookup
          !/SELECT pf\.featureKey, pf\.entitled\s+FROM shopsubscription ss\s+JOIN planfeature pf/.test(s),
      );
      expect(bad).toEqual([]);
    });
  });

  describe('platform admin: Billing view, no-subscription list, suspension reason', () => {
    it('GET /platform-admin/shops/:id/billing returns plan, usage, events and the suspension reason', async () => {
      const res = body<ShopBilling>(await platformGet(`/platform-admin/shops/${tenants.A.id}/billing`).expect(200));
      expect(res.subscription).toMatchObject({ hasSubscription: true, plan: { code: 'legacy_free' } });
      expect(res.usage.used).toBeGreaterThanOrEqual(2);
      expect(res.suspension).toEqual({ suspendedAt: null, reason: null });
      expect(res.events.some((e) => e.reason === 'backfill_legacy' && e.actorType === 'system')).toBe(true);
      await platformGet(`/platform-admin/shops/2147483000/billing`).expect(404);
    });

    it('is invisible (404) without a platform session, including to a shop admin token', async () => {
      await request(app.getHttpServer()).get(`/platform-admin/shops/${tenants.A.id}/billing`).expect(404);
      await request(app.getHttpServer())
        .get(`/platform-admin/shops/${tenants.A.id}/billing`)
        .set(auth('A'))
        .expect(404);
      await request(app.getHttpServer()).get(`/platform-admin/billing/shops-without-subscription`).set(auth('A')).expect(404);
    });

    it('lists shops with no subscription row', async () => {
      const lonely = await fixtureShop(3000 + (runId % 1000));
      await db.execute(`DELETE FROM shopsubscription WHERE shopId = ?`, [lonely]);
      const res = body<{ total: number; data: { id: number }[] }>(
        await platformGet(`/platform-admin/billing/shops-without-subscription`).expect(200),
      );
      expect(res.total).toBeGreaterThanOrEqual(1);
      expect(res.data.map((s) => s.id)).toContain(lonely);
    });

    it('suspend writes reason platform (overwriting a billing one) with the audit row; unsuspend clears it', async () => {
      const id = tenants.B.id;
      await db.execute(`UPDATE shop SET suspendedAt = NOW(), suspensionReason = 'billing' WHERE id = ?`, [id]);
      await platformPost(`/platform-admin/shops/${id}/suspend`).expect(201);
      const [s] = await db.query<RowDataPacket[]>(`SELECT suspendedAt, suspensionReason FROM shop WHERE id = ?`, [id]);
      expect(s.suspendedAt).not.toBeNull();
      expect(s.suspensionReason).toBe('platform');
      const audit = await db.query<RowDataPacket[]>(
        `SELECT action FROM platformauditlogentry WHERE shopId = ? AND action = 'shop.suspend'`,
        [id],
      );
      expect(audit.length).toBeGreaterThanOrEqual(1);
      await platformPost(`/platform-admin/shops/${id}/unsuspend`).expect(201);
      const [u] = await db.query<RowDataPacket[]>(`SELECT suspendedAt, suspensionReason FROM shop WHERE id = ?`, [id]);
      expect([u.suspendedAt, u.suspensionReason]).toEqual([null, null]);
    });

    it('a failed audit insert rolls the suspension back (one transaction)', async () => {
      const id = tenants.B.id;
      const spy = jest
        .spyOn(app.get(PlatformAuditLogService), 'log')
        .mockRejectedValue(new Error('audit down'));
      try {
        await platformPost(`/platform-admin/shops/${id}/suspend`).expect(500);
      } finally {
        spy.mockRestore();
      }
      const [s] = await db.query<RowDataPacket[]>(`SELECT suspendedAt, suspensionReason FROM shop WHERE id = ?`, [id]);
      expect([s.suspendedAt, s.suspensionReason]).toEqual([null, null]);
    });
  });
});
