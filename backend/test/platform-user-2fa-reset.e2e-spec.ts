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
import { PlatformAuditLogService } from '../src/platform-admin/platform-audit-log.service';
import { totpCode } from '../src/two-factor/totp';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
interface SignupRes extends Tokens {
  user: { id: number; shopId: number; email: string };
  devVerificationLink?: string;
}
interface MfaRequired {
  mfaRequired: true;
  mfaToken: string;
}
const body = <T>(r: Response) => r.body as T;
const PW = 'password123';
const PPW = 'platform-password-123';

function cookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.get('Set-Cookie') ?? []) {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

describe('Platform-admin reset of a shop user two-factor (S1a, e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  let platform: { cookie: string; csrf: string };

  beforeAll(async () => {
    const m: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
    const email = `s1a-pf-${runId}@test.com`;
    await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [email, await bcrypt.hash(PPW, 10), 'S1a Support'],
    );
    const res = await http()
      .post('/platform-auth/login')
      .send({ email, password: PPW })
      .expect(201);
    platform = {
      cookie: Object.entries(cookies(res))
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      csrf: res.get('X-CSRF-Token') as string,
    };
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const pGet = (path: string) =>
    http().get(path).set('Cookie', platform.cookie);
  const pReset = (shopId: number, userId: number) =>
    http()
      .post(`/platform-admin/shops/${shopId}/users/${userId}/reset-2fa`)
      .set('Cookie', platform.cookie)
      .set('X-CSRF-Token', platform.csrf);

  async function shop(prefix: string) {
    const email = `${prefix}-${runId}@test.com`;
    const res = await http()
      .post('/auth/signup')
      .send({
        name: 'Admin',
        email,
        password: PW,
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
      })
      .expect(201);
    const s = body<SignupRes>(res);
    await http()
      .post('/auth/verify-email')
      .send({
        token: new URL(s.devVerificationLink!).searchParams.get('token')!,
      })
      .expect(201);
    return { email, ...s };
  }

  async function enroll(t: Tokens) {
    const start = await http()
      .post('/auth/2fa/enroll/start')
      .set(bearer(t.accessToken))
      .send({ currentPassword: PW })
      .expect(201);
    const { secret } = body<{ secret: string }>(start);
    await http()
      .post('/auth/2fa/enroll/confirm')
      .set(bearer(t.accessToken))
      .send({ code: totpCode(secret, Date.now()) })
      .expect(201);
    return secret;
  }

  const scalar = async (sql: string, params: unknown[]) => {
    const rows = await db.query<RowDataPacket[]>(
      sql,
      params as (string | number)[],
    );
    return Number(rows[0].c);
  };
  const totpRows = (uid: number) =>
    scalar(`SELECT COUNT(*) AS c FROM usertotp WHERE userId = ?`, [uid]);
  const codeRows = (uid: number) =>
    scalar(`SELECT COUNT(*) AS c FROM userrecoverycode WHERE userId = ?`, [
      uid,
    ]);
  const flag = (uid: number) =>
    scalar(`SELECT mustEnrol2fa AS c FROM user WHERE id = ?`, [uid]);
  const liveSessions = (uid: number) =>
    scalar(
      `SELECT COUNT(*) AS c FROM refreshtoken WHERE userId = ? AND revokedAt IS NULL`,
      [uid],
    );
  const auditRows = (shopId: number, userId: number) =>
    scalar(
      `SELECT COUNT(*) AS c FROM platformauditlogentry
       WHERE shopId = ? AND action = 'shop.user_2fa_reset' AND JSON_EXTRACT(metadata, '$.userId') = ?`,
      [shopId, userId],
    );

  it('recovers the sole admin of a shop that requires 2FA, end to end', async () => {
    const a = await shop('s1a-sole');
    const secret = await enroll(a);
    await http()
      .put('/auth/2fa/shop-policy')
      .set(bearer(a.accessToken))
      .send({ required: true })
      .expect(200);
    await http().get('/products').set(bearer(a.accessToken)).expect(200);
    expect(await totpRows(a.user.id)).toBe(1);
    expect(await codeRows(a.user.id)).toBe(10);

    // lost device and recovery codes: platform support presses reset
    const res = await pReset(a.user.shopId, a.user.id).expect(201);
    expect(res.body).toEqual({ success: true });

    expect(await totpRows(a.user.id)).toBe(0);
    expect(await codeRows(a.user.id)).toBe(0);
    expect(await flag(a.user.id)).toBe(1);
    expect(await liveSessions(a.user.id)).toBe(0);
    expect(await auditRows(a.user.shopId, a.user.id)).toBe(1);

    // the old session died at once
    expect(
      (await http().get('/products').set(bearer(a.accessToken))).status,
    ).toBe(401);
    // the old secret is useless: the password alone logs in, with no 2FA step
    const login = await http()
      .post('/auth/login')
      .send({ email: a.email, password: PW })
      .expect(201);
    expect(body<Partial<MfaRequired>>(login).mfaRequired).toBeUndefined();
    const fresh = body<Tokens>(login);

    // ...but only into the enrolment-only scope
    const blocked = await http()
      .get('/products')
      .set(bearer(fresh.accessToken));
    expect(blocked.status).toBe(403);
    expect(body<{ code: string }>(blocked).code).toBe(
      'mfa_enrollment_required',
    );
    const me = await http()
      .get('/auth/me')
      .set(bearer(fresh.accessToken))
      .expect(200);
    expect(
      body<{ twoFactor: { enrollmentRequired: boolean } }>(me).twoFactor
        .enrollmentRequired,
    ).toBe(true);

    // enrolling again lifts it and clears the flag
    const secret2 = await enroll(fresh);
    expect(secret2).not.toBe(secret);
    expect(await flag(a.user.id)).toBe(0);
    await http().get('/products').set(bearer(fresh.accessToken)).expect(200);
  });

  it('forces re-enrolment even when the shop does not require 2FA', async () => {
    const a = await shop('s1a-optional');
    await enroll(a);
    await http().get('/products').set(bearer(a.accessToken)).expect(200);

    await pReset(a.user.shopId, a.user.id).expect(201);
    expect(await flag(a.user.id)).toBe(1);

    const login = await http()
      .post('/auth/login')
      .send({ email: a.email, password: PW })
      .expect(201);
    const fresh = body<Tokens>(login);
    expect(
      (await http().get('/products').set(bearer(fresh.accessToken))).status,
    ).toBe(403);
    // a flagged user cannot dodge it by turning 2FA "off" or any other route
    expect(
      (await http().get('/auth/sessions').set(bearer(fresh.accessToken)))
        .status,
    ).toBe(403);

    await enroll(fresh);
    expect(await flag(a.user.id)).toBe(0);
    await http().get('/products').set(bearer(fresh.accessToken)).expect(200);
  });

  it('queues a notification email with no secret or code in it, and writes the platform audit row without secrets', async () => {
    const a = await shop('s1a-mail');
    await enroll(a);
    await pReset(a.user.shopId, a.user.id).expect(201);
    const jobs = await db.query<RowDataPacket[]>(
      `SELECT payload FROM job WHERE type = 'send_email' AND idempotencyKey LIKE ?`,
      [`platform-2fa-reset-email:${a.user.id}:%`],
    );
    expect(jobs).toHaveLength(1);
    const payload = JSON.stringify(jobs[0].payload);
    expect(payload).toContain(a.email);
    expect(payload).toMatch(/reset two-factor/i);
    expect(payload).not.toMatch(/\b\d{6}\b/);

    const audit = await db.query<RowDataPacket[]>(
      `SELECT action, shopId, metadata FROM platformauditlogentry
       WHERE shopId = ? AND action = 'shop.user_2fa_reset'`,
      [a.user.shopId],
    );
    expect(audit).toHaveLength(1);
    const meta = audit[0].metadata as Record<string, unknown>;
    expect(meta).toEqual({
      userId: a.user.id,
      role: 'admin',
      wasEnrolled: true,
      sessionsRevoked: expect.any(Number) as number,
    });
  });

  it('a failed audit insert rolls the whole reset back', async () => {
    const a = await shop('s1a-rollback');
    await enroll(a);
    const audit = app.get(PlatformAuditLogService);
    const spy = jest
      .spyOn(audit, 'log')
      .mockRejectedValueOnce(new Error('audit insert failed'));
    const res = await pReset(a.user.shopId, a.user.id);
    spy.mockRestore();
    expect(res.status).toBe(500);

    expect(await totpRows(a.user.id)).toBe(1);
    expect(await codeRows(a.user.id)).toBe(10);
    expect(await flag(a.user.id)).toBe(0);
    expect(await liveSessions(a.user.id)).toBeGreaterThan(0);
    expect(
      await scalar(
        `SELECT COUNT(*) AS c FROM job WHERE idempotencyKey LIKE ?`,
        [`platform-2fa-reset-email:${a.user.id}:%`],
      ),
    ).toBe(0);
    await http().get('/products').set(bearer(a.accessToken)).expect(200);
  });

  it('is scoped by the shop in the URL: another shop user is the same 404 as a missing one', async () => {
    const a = await shop('s1a-xa');
    const b = await shop('s1a-xb');
    await enroll(b);

    const cross = await pReset(a.user.shopId, b.user.id);
    const missing = await pReset(a.user.shopId, 999999999);
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.body).toEqual(missing.body);

    // B is untouched
    expect(await totpRows(b.user.id)).toBe(1);
    expect(await flag(b.user.id)).toBe(0);
    expect(await liveSessions(b.user.id)).toBeGreaterThan(0);
    await http().get('/products').set(bearer(b.accessToken)).expect(200);
    expect(await auditRows(a.user.shopId, b.user.id)).toBe(0);
    expect(await auditRows(b.user.shopId, b.user.id)).toBe(0);

    // listing: shop A's list never shows B's user; unknown shop is 404
    const list = await pGet(
      `/platform-admin/shops/${a.user.shopId}/users`,
    ).expect(200);
    const ids = body<{ users: { id: number }[] }>(list).users.map((u) => u.id);
    expect(ids).toContain(a.user.id);
    expect(ids).not.toContain(b.user.id);
    await pGet('/platform-admin/shops/999999999/users').expect(404);
  });

  it('is invisible to everything but a platform admin session', async () => {
    const a = await shop('s1a-auth');
    const path = `/platform-admin/shops/${a.user.shopId}/users/${a.user.id}/reset-2fa`;
    // The platform CSRF middleware answers a POST that lacks its token with 403
    // before the guard runs (existing behaviour for every platform POST), so a
    // POST is only required to be refused; the GET twin proves the 404.
    const refused = (r: Response) => expect([403, 404]).toContain(r.status);
    await http().post(path).expect(refused);
    await http().post(path).set(bearer(a.accessToken)).expect(refused);
    await http()
      .post(path)
      .set(
        'Cookie',
        `__Host-req-staff-at=${a.accessToken}; req-staff-at=${a.accessToken}`,
      )
      .expect(refused);
    await http()
      .get(`/platform-admin/shops/${a.user.shopId}/users`)
      .expect(404);
    await http()
      .get(`/platform-admin/shops/${a.user.shopId}/users`)
      .set(bearer(a.accessToken))
      .expect(404);
    // a platform session without the CSRF header is refused, nothing changes
    await http()
      .post(path)
      .set('Cookie', platform.cookie)
      .expect((r) => expect(r.status).toBe(403));
    expect(await flag(a.user.id)).toBe(0);
    expect(await auditRows(a.user.shopId, a.user.id)).toBe(0);
  });

  it('cannot be used while impersonating that shop', async () => {
    const a = await shop('s1a-imp');
    const imp = await http()
      .post(`/platform-admin/shops/${a.user.shopId}/impersonate`)
      .set('Cookie', platform.cookie)
      .set('X-CSRF-Token', platform.csrf)
      .expect(201);
    const token = body<{ accessToken: string }>(imp).accessToken;
    await http()
      .post(
        `/platform-admin/shops/${a.user.shopId}/users/${a.user.id}/reset-2fa`,
      )
      .set(bearer(token))
      .expect((r) => expect([403, 404]).toContain(r.status));
    // and the merchant-side reset/enrol routes refuse an impersonation token
    await http()
      .post(`/auth/2fa/users/${a.user.id}/reset`)
      .set(bearer(token))
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
  });

  it('a user who is not enrolled: sessions cut, nothing forced, no secret fields in any response', async () => {
    const a = await shop('s1a-plain');
    const res = await pReset(a.user.shopId, a.user.id).expect(201);
    expect(res.body).toEqual({ success: true });
    expect(await flag(a.user.id)).toBe(0);
    expect(await totpRows(a.user.id)).toBe(0);
    expect(await liveSessions(a.user.id)).toBe(0);
    // idempotent
    await pReset(a.user.shopId, a.user.id).expect(201);
    expect(await flag(a.user.id)).toBe(0);
    // signs back in and works freely
    const login = await http()
      .post('/auth/login')
      .send({ email: a.email, password: PW })
      .expect(201);
    await http()
      .get('/products')
      .set(bearer(body<Tokens>(login).accessToken))
      .expect(200);

    const list = await pGet(
      `/platform-admin/shops/${a.user.shopId}/users`,
    ).expect(200);
    const text = JSON.stringify(list.body);
    for (const bad of [
      'passwordHash',
      'secret',
      'codeHash',
      'tokenHash',
      'refreshToken',
      '$2a$',
      '$2b$',
    ]) {
      expect(text).not.toContain(bad);
    }
    const row = body<{ users: Record<string, unknown>[] }>(list).users[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        'email',
        'id',
        'lastSignInAt',
        'mfaEnrolled',
        'mustEnrol2fa',
        'name',
        'outletId',
        'outletName',
        'role',
      ].sort(),
    );
  });

  it('PLATFORM_REQUIRE_2FA: an unenrolled platform admin cannot reach the list or the reset', async () => {
    const a = await shop('s1a-pfreq');
    await enroll(a);
    process.env.PLATFORM_REQUIRE_2FA = '1';
    try {
      const list = await pGet(`/platform-admin/shops/${a.user.shopId}/users`);
      expect(list.status).toBe(403);
      expect(body<{ code: string }>(list).code).toBe('mfa_enrollment_required');
      const res = await pReset(a.user.shopId, a.user.id);
      expect(res.status).toBe(403);
      expect(await totpRows(a.user.id)).toBe(1);
      expect(await flag(a.user.id)).toBe(0);
    } finally {
      delete process.env.PLATFORM_REQUIRE_2FA;
    }
  });
});
