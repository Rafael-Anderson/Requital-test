import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { totpCode } from '../src/two-factor/totp';
import { platformMfaSecret } from '../src/platform-auth/platform-two-factor.service';
import { staffMfaSecret } from '../src/two-factor/two-factor.service';

interface MfaRequired {
  mfaRequired: true;
  mfaToken: string;
}
const body = <T>(r: Response) => r.body as T;
const PW = 'platform-password-123';

function cookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.get('Set-Cookie') ?? []) {
    const pair = line.split(';')[0];
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

describe('Two-factor authentication, platform admin tier (STF-3, e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();
  let logged = '';
  let stdoutSpy: jest.SpyInstance;

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
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((c: string | Uint8Array) => {
        logged += String(c);
        return true;
      });
  });
  afterAll(async () => {
    stdoutSpy.mockRestore();
    delete process.env.PLATFORM_REQUIRE_2FA;
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function newAdmin(prefix: string) {
    const email = `${prefix}-${runId}@test.com`;
    const r = await db.execute(
      `INSERT INTO platformadmin (email, passwordHash, name) VALUES (?, ?, ?)`,
      [email, await bcrypt.hash(PW, 10), prefix],
    );
    return { email, id: r.insertId };
  }

  // A browser-like session: cookie header + csrf header from the login response.
  async function session(email: string) {
    const res = await http()
      .post('/platform-auth/login')
      .send({ email, password: PW })
      .expect(201);
    return sessionFrom(res);
  }
  function sessionFrom(res: Response) {
    const c = cookies(res);
    return {
      cookie: Object.entries(c)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      csrf: res.get('X-CSRF-Token') as string,
    };
  }
  const authed = (
    s: { cookie: string; csrf: string },
    method: 'get' | 'post',
    path: string,
  ) => {
    const r = http()[method](path).set('Cookie', s.cookie);
    return method === 'post' ? r.set('X-CSRF-Token', s.csrf) : r;
  };

  async function enroll(s: { cookie: string; csrf: string }) {
    const start = await authed(s, 'post', '/platform-auth/2fa/enroll/start')
      .send({ currentPassword: PW })
      .expect(201);
    const { secret } = body<{ secret: string }>(start);
    const confirm = await authed(s, 'post', '/platform-auth/2fa/enroll/confirm')
      .send({ code: totpCode(secret, Date.now()) })
      .expect(201);
    return {
      secret,
      recoveryCodes: body<{ recoveryCodes: string[] }>(confirm).recoveryCodes,
    };
  }
  const nextCode = (secret: string) => totpCode(secret, Date.now() + 30000);

  async function pending(email: string) {
    const r = await http()
      .post('/platform-auth/login')
      .send({ email, password: PW })
      .expect(201);
    expect(r.get('Set-Cookie')).toBeUndefined();
    return body<MfaRequired>(r);
  }
  const mfa = (mfaToken: string, code: string) =>
    http().post('/platform-auth/login/mfa').send({ mfaToken, code });

  it('enrol (password-gated, two-step), then login needs the code and issues the cookie only afterwards', async () => {
    const a = await newAdmin('pf-enroll');
    const s = await session(a.email);
    await authed(s, 'post', '/platform-auth/2fa/enroll/start')
      .send({ currentPassword: 'nope' })
      .expect(401);
    const { secret, recoveryCodes } = await enroll(s);
    expect(recoveryCodes).toHaveLength(10);

    const status = await authed(s, 'get', '/platform-auth/2fa').expect(200);
    expect(JSON.stringify(status.body)).not.toContain(secret);
    expect(body<{ enabled: boolean }>(status).enabled).toBe(true);

    const p = await pending(a.email);
    // the pending token is not a session, and a session is not a pending token
    await http()
      .get('/platform-auth/me')
      .set('Cookie', `req-platform-at=${p.mfaToken}`)
      .expect(404);
    const sessionToken = /req-platform-at=([^;]+)/.exec(s.cookie)![1];
    expect((await mfa(sessionToken, nextCode(secret))).status).toBe(401);

    const ok = await mfa(p.mfaToken, nextCode(secret)).expect(201);
    const c = cookies(ok);
    expect(c['req-platform-at']).toBeTruthy();
    await http()
      .get('/platform-auth/me')
      .set('Cookie', `req-platform-at=${c['req-platform-at']}`)
      .expect(200);

    // at rest
    const [row] = await db.query<RowDataPacket[]>(
      `SELECT secretEnc FROM platformadmintotp WHERE platformAdminId = ?`,
      [a.id],
    );
    expect(row.secretEnc).not.toContain(secret);
    void recoveryCodes;
  });

  it('replay, recovery codes (single use, one winner under concurrency) and lockout', async () => {
    const a = await newAdmin('pf-codes');
    const s = await session(a.email);
    const { secret, recoveryCodes } = await enroll(s);

    const code = nextCode(secret);
    const p1 = await pending(a.email);
    await mfa(p1.mfaToken, code).expect(201);
    const p2 = await pending(a.email);
    expect((await mfa(p2.mfaToken, code)).status).toBe(401); // replay

    const ps = await Promise.all([1, 2, 3, 4].map(() => pending(a.email)));
    const results = await Promise.all(
      ps.map((p) => mfa(p.mfaToken, recoveryCodes[0])),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('5 wrong codes (TOTP and recovery counted together) lock verification, even for the right code', async () => {
    const a = await newAdmin('pf-lock');
    const s = await session(a.email);
    const { secret } = await enroll(s);
    const p = await pending(a.email);
    for (const wrong of [
      '000000',
      '111111',
      '222222',
      '333333',
      'AAAA-BBBB-CCCC-DDDD',
    ]) {
      expect((await mfa(p.mfaToken, wrong)).status).toBe(401);
    }
    const locked = await mfa(p.mfaToken, nextCode(secret));
    expect(locked.status).toBe(429);
    expect(body<{ code: string }>(locked).code).toBe('mfa_locked');
  });

  it('pending tokens: wrong key, wrong typ, other tier, expired and password-bound are all refused', async () => {
    const a = await newAdmin('pf-token');
    const s = await session(a.email);
    const { secret } = await enroll(s);
    const jwt = app.get(JwtService, { strict: false });

    // real password fingerprint: each token is refused for the reason under test
    const [u] = await db.query<RowDataPacket[]>(
      `SELECT passwordHash FROM platformadmin WHERE id = ?`,
      [a.id],
    );
    const pwf = createHash('sha256')
      .update(u.passwordHash as string)
      .digest('hex')
      .slice(0, 16);
    const mk = (sec: string, typ: string, exp: string | number) =>
      jwt.signAsync(
        { sub: a.id, typ, pwf },
        { secret: sec, expiresIn: exp as never },
      );
    for (const t of [
      await mk(platformMfaSecret(), 'platform_mfa', -10),
      await mk(platformMfaSecret(), 'platform', '5m'),
      await mk(staffMfaSecret(), 'platform_mfa', '5m'),
      await mk(process.env.PLATFORM_JWT_SECRET!, 'platform_mfa', '5m'),
    ]) {
      expect((await mfa(t, nextCode(secret))).status).toBe(401);
    }
    const p = await pending(a.email);
    await db.execute(`UPDATE platformadmin SET passwordHash = ? WHERE id = ?`, [
      await bcrypt.hash('changed-password-1', 10),
      a.id,
    ]);
    expect((await mfa(p.mfaToken, nextCode(secret))).status).toBe(401);
  });

  it('disable and recovery regeneration need a valid code; a CLI password re-seed does not drop the factor', async () => {
    const a = await newAdmin('pf-manage');
    const s = await session(a.email);
    const { secret, recoveryCodes } = await enroll(s);
    await authed(s, 'post', '/platform-auth/2fa/disable')
      .send({ code: '000000' })
      .expect(401);
    await authed(s, 'post', '/platform-auth/2fa/recovery-codes')
      .send({ currentPassword: 'wrong', code: nextCode(secret) })
      .expect(401);
    const re = await authed(s, 'post', '/platform-auth/2fa/recovery-codes')
      .send({ currentPassword: PW, code: nextCode(secret) })
      .expect(201);
    const fresh = body<{ recoveryCodes: string[] }>(re).recoveryCodes;
    expect(fresh.some((c) => recoveryCodes.includes(c))).toBe(false);

    // seed-platform-admin's ON DUPLICATE KEY UPDATE only touches the password
    await db.execute(`UPDATE platformadmin SET passwordHash = ? WHERE id = ?`, [
      await bcrypt.hash(PW, 10),
      a.id,
    ]);
    await pending(a.email);

    await authed(s, 'post', '/platform-auth/2fa/disable')
      .send({ code: fresh[0] })
      .expect(201);
    const r = await http()
      .post('/platform-auth/login')
      .send({ email: a.email, password: PW })
      .expect(201);
    expect(cookies(r)['req-platform-at']).toBeTruthy();
  });

  it('CSRF: login/mfa is a pre-session endpoint, enrolment endpoints are protected', async () => {
    const a = await newAdmin('pf-csrf');
    const s = await session(a.email);
    const { secret } = await enroll(s);
    const p = await pending(a.email);
    await http()
      .post('/platform-auth/login/mfa')
      .set('Cookie', s.cookie) // stale session cookie, no CSRF header
      .send({ mfaToken: p.mfaToken, code: nextCode(secret) })
      .expect(201);
    await http()
      .post('/platform-auth/2fa/disable')
      .set('Cookie', s.cookie)
      .send({ code: '000000' })
      .expect(403);
  });

  it('PLATFORM_REQUIRE_2FA: an unenrolled admin reaches only me and enrolment, then everything', async () => {
    const a = await newAdmin('pf-require');
    const s = await session(a.email);
    await authed(s, 'get', '/platform-admin/shops').expect(200);
    process.env.PLATFORM_REQUIRE_2FA = '1';
    try {
      const blocked = await authed(s, 'get', '/platform-admin/shops');
      expect(blocked.status).toBe(403);
      expect(body<{ code: string }>(blocked).code).toBe(
        'mfa_enrollment_required',
      );
      await authed(s, 'get', '/platform-auth/me').expect(200);
      const { secret } = await enroll(s);
      await authed(s, 'get', '/platform-admin/shops').expect(200);
      // required: cannot be switched off
      await authed(s, 'post', '/platform-auth/2fa/disable')
        .send({ code: nextCode(secret) })
        .expect(403);
    } finally {
      delete process.env.PLATFORM_REQUIRE_2FA;
    }
  });

  it('a merchant staff session is not a platform session and vice versa; no secret reached the logs', async () => {
    const a = await newAdmin('pf-isolation');
    const s = await session(a.email);
    const { secret, recoveryCodes } = await enroll(s);
    const staff = await http()
      .post('/auth/signup')
      .send({
        name: 'M',
        email: `pf-merchant-${runId}@test.com`,
        password: 'password123',
        shopName: 'pf merchant',
        subdomain: `pf-merchant-${runId}`,
      })
      .expect(201);
    const staffToken = body<{ accessToken: string }>(staff).accessToken;
    await http()
      .get('/platform-auth/2fa')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(404);
    await http().get('/platform-auth/2fa').set('Cookie', s.cookie).expect(200);
    await http().get('/auth/2fa').set('Cookie', s.cookie).expect(401);

    const p = await pending(a.email);
    const code = nextCode(secret);
    await mfa(p.mfaToken, code).expect(201);
    for (const v of [
      secret,
      code,
      p.mfaToken,
      ...recoveryCodes,
      ...recoveryCodes.map((c) => c.replace(/-/g, '')),
    ]) {
      expect(logged).not.toContain(v);
    }
    const audit = await db.query<RowDataPacket[]>(
      `SELECT * FROM platformauditlogentry WHERE platformAdminId = ?`,
      [a.id],
    );
    const dump = JSON.stringify(audit);
    for (const v of [secret, code, ...recoveryCodes])
      expect(dump).not.toContain(v);
    expect(dump).toContain('platform.2fa_enabled');
  });
});
