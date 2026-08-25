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
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresIn?: number;
  devVerificationLink?: string;
}
interface PlatformShop {
  id: number;
  status: 'active' | 'suspended';
}
interface PlatformShopDetail {
  integrations: { whatsappConfigured: boolean };
}
interface MeResponse {
  impersonating?: boolean;
  shopId: number;
}
interface PlatformSettingsResponse {
  envVars: { name: string; configured: boolean }[];
  webhookUrls: { slider: string };
}
interface PlatformLoginErrorBody {
  message: string | string[];
}
interface AuditLogEntry {
  action: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Covers the scope's three required checks: platform token cannot access
// merchant routes and vice versa (separate JWT scope), impersonation writes
// an audit entry, and no secret values appear in any platform-admin
// response. Also covers suspend/unsuspend, since this spec is the natural
// home for the access-model coverage the Slider spec's own 404 test points
// back to.
describe('Platform admin (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  const shopSlug = `platform-admin-test-${runId}`;

  let shopId: number;
  let adminToken: string;
  let platformToken: string;
  let platformAdminId: number;

  beforeAll(async () => {
    // PLATFORM_JWT_SECRET must come from .env (loaded by the 'dotenv/config'
    // import at the top of this file), not set here — PlatformAuthModule's
    // JwtModule.register(...) reads process.env.PLATFORM_JWT_SECRET at
    // class-decorator/import time, which runs before this beforeAll ever
    // does (import { AppModule } below already triggered it).
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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Platform Test Merchant Admin',
        email: `platform-merchant-${runId}@test.com`,
        password: 'password123',
        shopName: 'Platform Test Shop',
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

    const passwordHash = await bcrypt.hash('platform-password-123', 10);
    const insertResult = await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [`platform-admin-${runId}@test.com`, passwordHash, 'Platform Test Admin'],
    );
    platformAdminId = insertResult.insertId;

    const platformLogin = await request(app.getHttpServer())
      .post('/platform-auth/login')
      .send({
        email: `platform-admin-${runId}@test.com`,
        password: 'platform-password-123',
      })
      .expect(201);
    platformToken = body<AuthResponse>(platformLogin).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('separate JWT scope', () => {
    it('a platform token cannot access a merchant route', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(401);
    });

    it('a merchant token cannot access a platform-admin route', async () => {
      await request(app.getHttpServer())
        .get('/platform-admin/shops')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('an unauthenticated request to a platform-admin route 404s, not 401/403', async () => {
      await request(app.getHttpServer())
        .get('/platform-admin/shops')
        .expect(404);
      await request(app.getHttpServer())
        .get(`/platform-admin/shops/${shopId}`)
        .expect(404);
    });
  });

  describe('shops list/detail', () => {
    it('lists the seeded shop and reveals no secret values', async () => {
      const res = await request(app.getHttpServer())
        .get('/platform-admin/shops')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      const shops = body<PlatformShop[]>(res);
      expect(shops.some((s) => s.id === shopId)).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('shop detail shows integration status by name only, never credential values', async () => {
      // Give the shop a WhatsApp credential to prove it stays out of this
      // response entirely, not just masked.
      await request(app.getHttpServer())
        .patch('/whatsapp-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          phoneNumberId: '1234567890',
          accessToken: 'super-secret-token-value',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/platform-admin/shops/${shopId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      expect(body<PlatformShopDetail>(res).integrations.whatsappConfigured).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(
        'super-secret-token-value',
      );
      expect(JSON.stringify(res.body)).not.toContain('1234567890');
    });
  });

  describe('suspend / unsuspend', () => {
    it('suspending a shop blocks merchant login and takes the storefront offline, reversibly', async () => {
      await request(app.getHttpServer())
        .post(`/platform-admin/shops/${shopId}/suspend`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `platform-merchant-${runId}@test.com`,
          password: 'password123',
        })
        .expect(403);

      // An already-issued token is also rejected on its very next request,
      // not just at login — see AuthGuard's per-request suspendedAt check.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      await request(app.getHttpServer()).get(`/public/${shopSlug}`).expect(404);

      await request(app.getHttpServer())
        .post(`/platform-admin/shops/${shopId}/unsuspend`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `platform-merchant-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
    });
  });

  describe('impersonation', () => {
    it('mints a short-lived, non-refreshable token and writes the audit entry before returning', async () => {
      const res = await request(app.getHttpServer())
        .post(`/platform-admin/shops/${shopId}/impersonate`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(201);
      const session = body<AuthResponse>(res);
      expect(session.refreshToken).toBeNull();
      expect(session.accessTokenExpiresIn).toBe(60 * 60);

      // The audit row must exist immediately — not deferred to some later
      // "end impersonation" call this test never makes.
      const rows = await db.query<RowDataPacket[]>(
        `SELECT * FROM platformauditlogentry WHERE platformAdminId = ? AND shopId = ? AND action = 'shop.impersonate' ORDER BY id DESC LIMIT 1`,
        [platformAdminId, shopId],
      );
      expect(rows.length).toBe(1);

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      const meBody = body<MeResponse>(me);
      expect(meBody.impersonating).toBe(true);
      expect(meBody.shopId).toBe(shopId);
    });

    it('also appears in GET /platform-admin/audit-log', async () => {
      const res = await request(app.getHttpServer())
        .get(`/platform-admin/audit-log?shopId=${shopId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      const entries = body<AuditLogEntry[]>(res);
      expect(entries.some((e) => e.action === 'shop.impersonate')).toBe(true);
    });
  });

  describe('platform settings', () => {
    it('reports configured/not-configured only, never a value', async () => {
      const res = await request(app.getHttpServer())
        .get('/platform-admin/settings')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      const settings = body<PlatformSettingsResponse>(res);
      expect(Array.isArray(settings.envVars)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(
        process.env.JWT_SECRET ?? '__unset__',
      );
      for (const entry of settings.envVars) {
        expect(typeof entry.configured).toBe('boolean');
      }
      expect(settings.webhookUrls.slider).toContain('/slider/webhook');
    });
  });

  describe('platform login', () => {
    it('rejects a wrong password without revealing whether the email exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/platform-auth/login')
        .send({ email: `platform-admin-${runId}@test.com`, password: 'wrong' })
        .expect(401);
      const res2 = await request(app.getHttpServer())
        .post('/platform-auth/login')
        .send({ email: 'no-such-platform-admin@test.com', password: 'wrong' })
        .expect(401);
      expect(body<PlatformLoginErrorBody>(res).message).toEqual(
        body<PlatformLoginErrorBody>(res2).message,
      );
    });
  });
});
