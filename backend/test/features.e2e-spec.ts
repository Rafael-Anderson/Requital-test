import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { FeaturesService } from '../src/features/features.service';
import { FEATURE_KEYS, FEATURE_KEY_LIST } from '../src/features/feature-keys';
import { SliderSettingsService } from '../src/delivery-providers/slider-settings.service';
import { LowStockDigestService } from '../src/products/low-stock-digest.service';
import { PlatformAuditLogService } from '../src/platform-admin/platform-audit-log.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface FeatureStatus {
  key: string;
  columnValue: boolean | null;
  override: { enabled: boolean; note: string | null } | null;
  effective: boolean;
}
interface PublicShop {
  productImageZoomEnabled: boolean;
  showCollectionMenu: boolean;
}

function body<T>(res: Response): T {
  return res.body as T;
}
function extractCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.get('Set-Cookie') ?? []) {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

describe('Feature flag resolver (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let features: FeaturesService;
  const runId = Date.now();
  const platformEmail = `features-platform-${runId}@test.com`;
  const platformPassword = 'platform-password-123';
  let platformCookie: string;
  let platformCsrf: string;
  let platformAdminId: number;

  const shops: Record<'A' | 'B', { id: number; slug: string; token: string }> =
    { A: { id: 0, slug: '', token: '' }, B: { id: 0, slug: '', token: '' } };

  async function signup(tag: 'A' | 'B') {
    const slug = `feat-${tag.toLowerCase()}-${runId}`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: `Features ${tag}`,
        email: `features-${tag}-${runId}@test.com`,
        password: 'password123',
        shopName: `Features ${tag}`,
        subdomain: slug,
      })
      .expect(201);
    const token = body<AuthResponse>(res).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(res).devVerificationLink,
    );
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    shops[tag] = { id: body<{ shopId: number }>(me).shopId, slug, token };
  }

  const put = (shopId: number, key: string, payload: object) =>
    request(app.getHttpServer())
      .put(`/platform-admin/shops/${shopId}/features/${key}`)
      .set('Cookie', platformCookie)
      .set('X-CSRF-Token', platformCsrf)
      .send(payload);
  const del = (shopId: number, key: string) =>
    request(app.getHttpServer())
      .delete(`/platform-admin/shops/${shopId}/features/${key}`)
      .set('Cookie', platformCookie)
      .set('X-CSRF-Token', platformCsrf);
  const getFeatures = (shopId: number) =>
    request(app.getHttpServer())
      .get(`/platform-admin/shops/${shopId}/features`)
      .set('Cookie', platformCookie);
  const publicShop = async (slug: string) =>
    body<PublicShop>(
      await request(app.getHttpServer()).get(`/public/${slug}`).expect(200),
    );
  const overrideRows = (shopId: number) =>
    db.query<RowDataPacket[]>(
      `SELECT featureKey, enabled FROM shopfeatureoverride WHERE shopId = ?`,
      [shopId],
    );

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
    features = app.get(FeaturesService);

    await signup('A');
    await signup('B');

    const hash = await bcrypt.hash(platformPassword, 10);
    const ins = await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [platformEmail, hash, 'Features Platform Admin'],
    );
    platformAdminId = ins.insertId;
    const login = await request(app.getHttpServer())
      .post('/platform-auth/login')
      .send({ email: platformEmail, password: platformPassword })
      .expect(201);
    const cookies = extractCookies(login);
    platformCookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    platformCsrf = cookies['req-platform-csrf'];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('no override rows: byte-identical to the shop columns', () => {
    it('every registry key resolves to exactly its own column, for varied column values', async () => {
      // Flip every column away from its DB default so a resolver that fell
      // through to the registry default (instead of the column) would differ.
      for (const k of FEATURE_KEY_LIST) {
        const d = FEATURE_KEYS[k];
        if (d.source !== 'column') continue;
        await db.execute(`UPDATE shop SET \`${d.column}\` = ? WHERE id = ?`, [
          !d.default,
          shops.A.id,
        ]);
      }
      expect(await overrideRows(shops.A.id)).toHaveLength(0);
      const flags = await features.getFlags(shops.A.id);
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT * FROM shop WHERE id = ?`,
        [shops.A.id],
      );
      for (const k of FEATURE_KEY_LIST) {
        const d = FEATURE_KEYS[k];
        if (d.source !== 'column') continue;
        expect([k, flags[k]]).toEqual([k, Boolean(row[d.column])]);
        expect([k, flags[k]]).toEqual([k, !d.default]);
      }
      // restore for later tests
      for (const k of FEATURE_KEY_LIST) {
        const d = FEATURE_KEYS[k];
        if (d.source !== 'column') continue;
        await db.execute(`UPDATE shop SET \`${d.column}\` = ? WHERE id = ?`, [
          d.default,
          shops.A.id,
        ]);
      }
    });

    it('the public payload reports the columns when there is no override', async () => {
      const pa = await publicShop(shops.A.slug);
      expect(pa.productImageZoomEnabled).toBe(true);
      expect(pa.showCollectionMenu).toBe(true);
    });

    it('a shop that does not exist has every feature off, never a default', async () => {
      const flags = await features.getFlags(2147483000);
      expect(Object.values(flags).every((v) => v === false)).toBe(true);
    });
  });

  describe('platform override: set, take effect at real call sites, clear', () => {
    it('override OFF changes the public payload for that shop only, clearing restores it', async () => {
      const res = await put(shops.A.id, 'product_image_zoom', {
        enabled: false,
        note: `runId ${runId}`,
      }).expect(200);
      const st = body<FeatureStatus[]>(res).find(
        (s) => s.key === 'product_image_zoom',
      );
      expect(st).toMatchObject({
        columnValue: true,
        effective: false,
        override: { enabled: false, note: `runId ${runId}` },
      });

      expect((await publicShop(shops.A.slug)).productImageZoomEnabled).toBe(
        false,
      );
      // Cross-tenant: shop B is untouched.
      expect((await publicShop(shops.B.slug)).productImageZoomEnabled).toBe(
        true,
      );
      expect(await features.isEnabled(shops.B.id, 'product_image_zoom')).toBe(
        true,
      );
      expect(await overrideRows(shops.B.id)).toHaveLength(0);

      await del(shops.A.id, 'product_image_zoom').expect(200);
      expect((await publicShop(shops.A.slug)).productImageZoomEnabled).toBe(
        true,
      );
    });

    it('override ON enables the low stock digest although the shop column is off', async () => {
      const [before] = await db.query<RowDataPacket[]>(
        `SELECT notifyLowStockDigest, lowStockDigestLastSentAt FROM shop WHERE id = ?`,
        [shops.A.id],
      );
      expect(Boolean(before.notifyLowStockDigest)).toBe(false);
      const digest = app.get(LowStockDigestService);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // Off: gate closes, nothing is claimed.
      await digest.sendForShop(shops.A.id, 'A', null, startOfToday);
      let [row] = await db.query<RowDataPacket[]>(
        `SELECT lowStockDigestLastSentAt FROM shop WHERE id = ?`,
        [shops.A.id],
      );
      expect(row.lowStockDigestLastSentAt).toBeNull();

      await put(shops.A.id, 'low_stock_digest', { enabled: true }).expect(200);
      expect(await features.enabledShopIds('low_stock_digest')).toContain(
        shops.A.id,
      );
      expect(await features.enabledShopIds('low_stock_digest')).not.toContain(
        shops.B.id,
      );
      await digest.sendForShop(shops.A.id, 'A', null, startOfToday);
      [row] = await db.query<RowDataPacket[]>(
        `SELECT lowStockDigestLastSentAt FROM shop WHERE id = ?`,
        [shops.A.id],
      );
      // The CAS claim ran: the override opened the gate and the old column
      // predicate no longer vetoes it.
      expect(row.lowStockDigestLastSentAt).not.toBeNull();
      await del(shops.A.id, 'low_stock_digest').expect(200);
    });

    it('override OFF closes Slider for a shop that enabled it; override ON opens it for one that did not', async () => {
      const slider = app.get(SliderSettingsService);
      const prev = {
        k: process.env.SLIDER_API_KEY,
        e: process.env.SLIDER_ENVIRONMENT,
      };
      process.env.SLIDER_API_KEY = 'sk_test_platform';
      process.env.SLIDER_ENVIRONMENT = 'sandbox';
      try {
        await db.execute(
          `UPDATE shop SET sliderEnabled = 1, sliderAccountId = 'acct_a' WHERE id = ?`,
          [shops.A.id],
        );
        await db.execute(
          `UPDATE shop SET sliderEnabled = 0, sliderAccountId = 'acct_b' WHERE id = ?`,
          [shops.B.id],
        );
        expect(await slider.resolveCredentials(shops.A.id)).not.toBeNull();
        expect(await slider.resolveCredentials(shops.B.id)).toBeNull();

        await put(shops.A.id, 'slider', { enabled: false }).expect(200);
        await put(shops.B.id, 'slider', { enabled: true }).expect(200);
        expect(await slider.resolveCredentials(shops.A.id)).toBeNull();
        expect(await slider.resolveCredentials(shops.B.id)).not.toBeNull();
        await del(shops.A.id, 'slider').expect(200);
        await del(shops.B.id, 'slider').expect(200);
        expect(await slider.resolveCredentials(shops.A.id)).not.toBeNull();
        expect(await slider.resolveCredentials(shops.B.id)).toBeNull();
      } finally {
        process.env.SLIDER_API_KEY = prev.k;
        process.env.SLIDER_ENVIRONMENT = prev.e;
        if (prev.k === undefined) delete process.env.SLIDER_API_KEY;
        if (prev.e === undefined) delete process.env.SLIDER_ENVIRONMENT;
      }
    });

    it('enabledShopIds agrees with isEnabled for every key across override states', async () => {
      await put(shops.A.id, 'notify_email', { enabled: true }).expect(200);
      await put(shops.B.id, 'auto_deduct_ingredient_stock', {
        enabled: false,
      }).expect(200);
      for (const key of FEATURE_KEY_LIST) {
        const ids = await features.enabledShopIds(key);
        for (const s of [shops.A, shops.B]) {
          expect([key, s.id, ids.includes(s.id)]).toEqual([
            key,
            s.id,
            await features.isEnabled(s.id, key),
          ]);
        }
      }
      await del(shops.A.id, 'notify_email').expect(200);
      await del(shops.B.id, 'auto_deduct_ingredient_stock').expect(200);
    });
  });

  describe('privilege boundary', () => {
    it('a shop admin token cannot read or write overrides, and nothing is written', async () => {
      const t = shops.A.token;
      const base = `/platform-admin/shops/${shops.A.id}/features`;
      await request(app.getHttpServer())
        .get(base)
        .set('Authorization', `Bearer ${t}`)
        .expect(404);
      // Writes hit the platform CSRF check before the guard, so 403 is as good a
      // refusal as 404; what matters is that nothing was written.
      const w = await request(app.getHttpServer())
        .put(`${base}/slider`)
        .set('Authorization', `Bearer ${t}`)
        .send({ enabled: true });
      expect([403, 404]).toContain(w.status);
      const d = await request(app.getHttpServer())
        .delete(`${base}/slider`)
        .set('Authorization', `Bearer ${t}`);
      expect([403, 404]).toContain(d.status);
      expect(await overrideRows(shops.A.id)).toHaveLength(0);
    });

    it('unauthenticated requests are refused (404 read, CSRF 403 write) and write nothing', async () => {
      await request(app.getHttpServer())
        .get(`/platform-admin/shops/${shops.A.id}/features`)
        .expect(404);
      const res = await request(app.getHttpServer())
        .put(`/platform-admin/shops/${shops.A.id}/features/slider`)
        .send({ enabled: true });
      expect([403, 404]).toContain(res.status);
      expect(await overrideRows(shops.A.id)).toHaveLength(0);
    });

    it('the merchant settings endpoint cannot smuggle an override in', async () => {
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shops.A.token}`)
        .send({ featureOverrides: { slider: true }, enabled: true })
        .expect(400);
      expect(await overrideRows(shops.A.id)).toHaveLength(0);
    });

    it('a platform write needs the CSRF header', async () => {
      await request(app.getHttpServer())
        .put(`/platform-admin/shops/${shops.A.id}/features/slider`)
        .set('Cookie', platformCookie)
        .send({ enabled: true })
        .expect(403);
      expect(await overrideRows(shops.A.id)).toHaveLength(0);
    });

    it('validates shop, key and body', async () => {
      await put(2147483000, 'slider', { enabled: true }).expect(404);
      await put(shops.A.id, 'not_a_feature', { enabled: true }).expect(404);
      await put(shops.A.id, 'constructor', { enabled: true }).expect(404);
      await put(shops.A.id, 'slider', { enabled: 'yes' }).expect(400);
      await put(shops.A.id, 'slider', {
        enabled: true,
        shopId: shops.B.id,
      }).expect(400);
      await getFeatures(2147483000).expect(404);
      expect(await overrideRows(shops.A.id)).toHaveLength(0);
      expect(await overrideRows(shops.B.id)).toHaveLength(0);
    });
  });

  describe('audit log', () => {
    it('set and clear each write a platformauditlogentry', async () => {
      await put(shops.A.id, 'collection_menu', {
        enabled: false,
        note: 'audit',
      }).expect(200);
      await del(shops.A.id, 'collection_menu').expect(200);
      // clearing something that is not set changes nothing and logs nothing
      await del(shops.A.id, 'collection_menu').expect(200);
      const rows = await db.query<RowDataPacket[]>(
        `SELECT action, metadata FROM platformauditlogentry
          WHERE platformAdminId = ? AND shopId = ? ORDER BY id`,
        [platformAdminId, shops.A.id],
      );
      // Other tests in this file also log against shop A; look at this key only.
      const mine = rows.filter(
        (r) =>
          String(r.action).startsWith('shop.feature_override.') &&
          (r.metadata as { key: string }).key === 'collection_menu',
      );
      expect(mine.map((r) => r.action as string)).toEqual([
        'shop.feature_override.set',
        'shop.feature_override.clear',
      ]);
      const meta = mine[0].metadata as {
        key: string;
        enabled: boolean;
        note: string;
      };
      expect(meta).toEqual({
        key: 'collection_menu',
        enabled: false,
        note: 'audit',
      });
    });

    it('if the audit insert fails the override is rolled back and the request fails', async () => {
      const audit = app.get(PlatformAuditLogService);
      const spy = jest
        .spyOn(audit, 'log')
        .mockRejectedValueOnce(new Error('audit down'));
      await put(shops.A.id, 'whatsapp_floating_button', {
        enabled: true,
      }).expect(500);
      spy.mockRestore();
      expect(
        (await overrideRows(shops.A.id)).filter(
          (r) => r.featureKey === 'whatsapp_floating_button',
        ),
      ).toHaveLength(0);
    });
  });
});
