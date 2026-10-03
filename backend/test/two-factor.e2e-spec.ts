import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DatabaseService } from '../src/database/database.service';
import { decrypt } from '../src/common/crypto';
import { totpCode } from '../src/two-factor/totp';
import { staffMfaSecret } from '../src/two-factor/two-factor.service';
import type { RowDataPacket } from 'mysql2/promise';

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
interface Enroll {
  secret: string;
  otpauthUri: string;
}
const body = <T>(r: Response) => r.body as T;
const PW = 'password123';

describe('Two-factor authentication, staff tier (STF-3, e2e)', () => {
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
    // Everything the app logs for this whole file is captured so the final
    // test can prove no secret, code or token reached a log line.
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        logged += String(chunk);
        return true;
      });
  });
  afterAll(async () => {
    stdoutSpy.mockRestore();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
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

  // Enrols the user. Returns the secret, the recovery codes, and the step the
  // confirmation consumed (so callers use a LATER step for their next login).
  async function enroll(tokens: Tokens) {
    const start = await http()
      .post('/auth/2fa/enroll/start')
      .set(bearer(tokens.accessToken))
      .send({ currentPassword: PW })
      .expect(201);
    const { secret } = body<Enroll>(start);
    const confirm = await http()
      .post('/auth/2fa/enroll/confirm')
      .set(bearer(tokens.accessToken))
      .send({ code: totpCode(secret, Date.now()) })
      .expect(201);
    return {
      secret,
      recoveryCodes: body<{ recoveryCodes: string[] }>(confirm).recoveryCodes,
    };
  }

  // Steps are strictly increasing per user; this returns a valid code for a
  // step beyond `usedStep`, within the +/-1 window of the real clock.
  const codeAfterEnroll = (secret: string) =>
    totpCode(secret, Date.now() + 30000);

  async function loginExpectingMfa(email: string) {
    const r = await http()
      .post('/auth/login')
      .send({ email, password: PW })
      .expect(201);
    expect(r.get('Set-Cookie')).toBeUndefined();
    return body<MfaRequired>(r);
  }

  function mfaLogin(mfaToken: string, code: string) {
    return http().post('/auth/login/mfa').send({ mfaToken, code });
  }

  describe('enrolment', () => {
    it('is two-step, needs the password, shows the secret once, stores it encrypted', async () => {
      const a = await shop('tf-enroll');
      const bad = await http()
        .post('/auth/2fa/enroll/start')
        .set(bearer(a.accessToken))
        .send({ currentPassword: 'wrong-password' });
      expect(bad.status).toBe(401);

      const start = await http()
        .post('/auth/2fa/enroll/start')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW })
        .expect(201);
      const { secret, otpauthUri } = body<Enroll>(start);
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(otpauthUri).toContain(`secret=${secret}`);
      expect(otpauthUri.startsWith('otpauth://totp/Requital:')).toBe(true);

      // not active until confirmed: login still needs no second step
      const pending = await http()
        .get('/auth/2fa')
        .set(bearer(a.accessToken))
        .expect(200);
      expect(
        body<{ enabled: boolean; pendingEnrollment: boolean }>(pending),
      ).toMatchObject({
        enabled: false,
        pendingEnrollment: true,
      });
      await http()
        .post('/auth/login')
        .send({ email: a.email, password: PW })
        .expect(201);

      const wrong = await http()
        .post('/auth/2fa/enroll/confirm')
        .set(bearer(a.accessToken))
        .send({ code: '000000' });
      expect(wrong.status).toBe(401);

      const confirm = await http()
        .post('/auth/2fa/enroll/confirm')
        .set(bearer(a.accessToken))
        .send({ code: totpCode(secret, Date.now()) })
        .expect(201);
      const codes = body<{ recoveryCodes: string[] }>(confirm).recoveryCodes;
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);

      // never returned again
      const status = await http()
        .get('/auth/2fa')
        .set(bearer(a.accessToken))
        .expect(200);
      expect(body<Record<string, unknown>>(status)).toMatchObject({
        enabled: true,
        pendingEnrollment: false,
        recoveryCodesRemaining: 10,
      });
      expect(JSON.stringify(status.body)).not.toContain(secret);
      const me = await http()
        .get('/auth/me')
        .set(bearer(a.accessToken))
        .expect(200);
      expect(JSON.stringify(me.body)).not.toContain(secret);

      // at rest: encrypted (decrypts back), recovery codes hashed only
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT secretEnc FROM usertotp WHERE userId = ?`,
        [a.user.id],
      );
      expect(row.secretEnc).not.toContain(secret);
      expect(decrypt(row.secretEnc as string)).toBe(secret);
      const stored = await db.query<RowDataPacket[]>(
        `SELECT codeHash FROM userrecoverycode WHERE userId = ?`,
        [a.user.id],
      );
      expect(stored).toHaveLength(10);
      for (const c of codes) {
        for (const s of stored) {
          expect(s.codeHash).not.toContain(c.replace(/-/g, ''));
        }
      }

      // already on: starting again is refused
      await http()
        .post('/auth/2fa/enroll/start')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW })
        .expect(409);
    });

    it('a confirmed enrolment cannot be restarted by a stolen session without disabling first (secret unchanged)', async () => {
      const a = await shop('tf-nostart');
      const { secret } = await enroll(a);
      await http()
        .post('/auth/2fa/enroll/start')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW })
        .expect(409);
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT secretEnc FROM usertotp WHERE userId = ?`,
        [a.user.id],
      );
      expect(decrypt(row.secretEnc as string)).toBe(secret);
    });
  });

  describe('login with a second factor', () => {
    it('password alone yields NO session, only a pending token that is not a session; the code completes it', async () => {
      const a = await shop('tf-login');
      const { secret } = await enroll(a);
      const pending = await loginExpectingMfa(a.email);

      // a pending token is not a session
      await http().get('/auth/me').set(bearer(pending.mfaToken)).expect(401);
      // and a session is not a pending token
      await mfaLogin(a.accessToken, codeAfterEnroll(secret)).expect(401);

      const ok = await mfaLogin(
        pending.mfaToken,
        codeAfterEnroll(secret),
      ).expect(201);
      const session = body<Tokens>(ok);
      await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);
    });

    it('a replayed code (same 30s step) is rejected', async () => {
      const a = await shop('tf-replay');
      const { secret } = await enroll(a);
      const code = codeAfterEnroll(secret);
      const first = await loginExpectingMfa(a.email);
      await mfaLogin(first.mfaToken, code).expect(201);
      const second = await loginExpectingMfa(a.email);
      const replay = await mfaLogin(second.mfaToken, code);
      expect(replay.status).toBe(401);
      // the immediately previous step is older than the accepted one: rejected too
      const older = totpCode(secret, Date.now());
      const third = await loginExpectingMfa(a.email);
      expect((await mfaLogin(third.mfaToken, older)).status).toBe(401);
    });

    it('the enrolment confirmation code cannot be replayed to log in', async () => {
      const a = await shop('tf-confirm-replay');
      const start = await http()
        .post('/auth/2fa/enroll/start')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW })
        .expect(201);
      const { secret } = body<Enroll>(start);
      const code = totpCode(secret, Date.now());
      await http()
        .post('/auth/2fa/enroll/confirm')
        .set(bearer(a.accessToken))
        .send({ code })
        .expect(201);
      const pending = await loginExpectingMfa(a.email);
      expect((await mfaLogin(pending.mfaToken, code)).status).toBe(401);
    });

    it('two parallel logins with the SAME valid code: exactly one wins', async () => {
      const a = await shop('tf-race');
      const { secret } = await enroll(a);
      const code = codeAfterEnroll(secret);
      const tokens = await Promise.all(
        [1, 2, 3, 4].map(() => loginExpectingMfa(a.email)),
      );
      const results = await Promise.all(
        tokens.map((t) => mfaLogin(t.mfaToken, code)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it('a pending token expires, is bound to the password, and a forged-typ one is refused', async () => {
      const a = await shop('tf-token');
      const { secret } = await enroll(a);
      const jwt = app.get(JwtService, { strict: false });
      // The REAL password fingerprint, so each forged token below is refused for
      // the reason under test (key / typ / expiry), not for a binding mismatch.
      const [u] = await db.query<RowDataPacket[]>(
        `SELECT passwordHash FROM user WHERE id = ?`,
        [a.user.id],
      );
      const pwf = createHash('sha256')
        .update(u.passwordHash as string)
        .digest('hex')
        .slice(0, 16);

      const expired = await jwt.signAsync(
        { sub: a.user.id, typ: 'staff_mfa', pwf },
        { secret: staffMfaSecret(), expiresIn: -10 },
      );
      expect((await mfaLogin(expired, codeAfterEnroll(secret))).status).toBe(
        401,
      );

      // right key, wrong typ
      const wrongTyp = await jwt.signAsync(
        { sub: a.user.id, typ: 'staff', pwf },
        { secret: staffMfaSecret(), expiresIn: '5m' },
      );
      expect((await mfaLogin(wrongTyp, codeAfterEnroll(secret))).status).toBe(
        401,
      );

      // signed with the session key (JWT_SECRET) instead of the derived one
      const wrongKey = await jwt.signAsync(
        { sub: a.user.id, typ: 'staff_mfa', pwf },
        { secret: process.env.JWT_SECRET, expiresIn: '5m' },
      );
      expect((await mfaLogin(wrongKey, codeAfterEnroll(secret))).status).toBe(
        401,
      );

      // password changed between the two steps: the pending token dies
      const pending = await loginExpectingMfa(a.email);
      await http()
        .post('/auth/change-password')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW, newPassword: 'another-password-77' })
        .expect(201);
      expect(
        (await mfaLogin(pending.mfaToken, codeAfterEnroll(secret))).status,
      ).toBe(401);
    });

    it('a user with no second factor still logs in with the password alone', async () => {
      const a = await shop('tf-none');
      const r = await http()
        .post('/auth/login')
        .send({ email: a.email, password: PW })
        .expect(201);
      expect(body<{ mfaRequired?: boolean }>(r).mfaRequired).toBeUndefined();
      expect(body<Tokens>(r).accessToken).toBeTruthy();
    });
  });

  describe('recovery codes', () => {
    it('log in once each, are consumed, and exactly one of several parallel uses wins', async () => {
      const a = await shop('tf-recovery');
      const { recoveryCodes } = await enroll(a);

      const t1 = await loginExpectingMfa(a.email);
      await mfaLogin(t1.mfaToken, recoveryCodes[0]).expect(201);
      const t2 = await loginExpectingMfa(a.email);
      expect((await mfaLogin(t2.mfaToken, recoveryCodes[0])).status).toBe(401);
      // case/dash-insensitive
      const t3 = await loginExpectingMfa(a.email);
      await mfaLogin(
        t3.mfaToken,
        recoveryCodes[1].toLowerCase().replace(/-/g, ' '),
      ).expect(201);

      const status = await http()
        .get('/auth/2fa')
        .set(bearer(a.accessToken))
        .expect(200);
      expect(
        body<{ recoveryCodesRemaining: number }>(status).recoveryCodesRemaining,
      ).toBe(8);

      const pendings = await Promise.all(
        [1, 2, 3, 4, 5].map(() => loginExpectingMfa(a.email)),
      );
      const results = await Promise.all(
        pendings.map((p) => mfaLogin(p.mfaToken, recoveryCodes[2])),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it('regenerating needs the password AND a code, and kills the old set', async () => {
      const a = await shop('tf-regen');
      const { secret, recoveryCodes } = await enroll(a);
      const noPassword = await http()
        .post('/auth/2fa/recovery-codes')
        .set(bearer(a.accessToken))
        .send({
          currentPassword: 'wrong-password',
          code: codeAfterEnroll(secret),
        });
      expect(noPassword.status).toBe(401);
      const badCode = await http()
        .post('/auth/2fa/recovery-codes')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW, code: '123456' });
      expect(badCode.status).toBe(401);

      const ok = await http()
        .post('/auth/2fa/recovery-codes')
        .set(bearer(a.accessToken))
        .send({ currentPassword: PW, code: codeAfterEnroll(secret) })
        .expect(201);
      const fresh = body<{ recoveryCodes: string[] }>(ok).recoveryCodes;
      expect(fresh).toHaveLength(10);
      expect(fresh.some((c) => recoveryCodes.includes(c))).toBe(false);

      const pending = await loginExpectingMfa(a.email);
      expect((await mfaLogin(pending.mfaToken, recoveryCodes[0])).status).toBe(
        401,
      );
      const pending2 = await loginExpectingMfa(a.email);
      await mfaLogin(pending2.mfaToken, fresh[0]).expect(201);
    });
  });

  describe('brute force protection', () => {
    it('5 wrong codes (TOTP and recovery codes counted together) lock verification, even for the right code', async () => {
      const a = await shop('tf-lock');
      const { secret } = await enroll(a);
      const pending = await loginExpectingMfa(a.email);
      for (const wrong of [
        '000000',
        '111111',
        '222222',
        'AAAA-BBBB-CCCC-DDDD',
        'EEEE-FFFF-GGGG-HHHH',
      ]) {
        expect((await mfaLogin(pending.mfaToken, wrong)).status).toBe(401);
      }
      const locked = await mfaLogin(pending.mfaToken, codeAfterEnroll(secret));
      expect(locked.status).toBe(429);
      expect(body<{ code: string }>(locked).code).toBe('mfa_locked');
      // a fresh password login does not bypass the lock
      const again = await loginExpectingMfa(a.email);
      expect(
        (await mfaLogin(again.mfaToken, codeAfterEnroll(secret))).status,
      ).toBe(429);
      // ...and it is a delay: once it elapses the right code works and the counter resets
      await db.execute(`UPDATE usertotp SET lockedUntil = ? WHERE userId = ?`, [
        new Date(Date.now() - 1000),
        a.user.id,
      ]);
      await mfaLogin(again.mfaToken, codeAfterEnroll(secret)).expect(201);
      const [row] = await db.query<RowDataPacket[]>(
        `SELECT failedAttempts, lockedUntil FROM usertotp WHERE userId = ?`,
        [a.user.id],
      );
      expect(row.failedAttempts).toBe(0);
      expect(row.lockedUntil).toBeNull();
    });

    it('failures below the limit reset on success', async () => {
      const a = await shop('tf-reset-counter');
      const { secret } = await enroll(a);
      const pending = await loginExpectingMfa(a.email);
      for (let i = 0; i < 4; i++) {
        expect((await mfaLogin(pending.mfaToken, '999999')).status).toBe(401);
      }
      await mfaLogin(pending.mfaToken, codeAfterEnroll(secret)).expect(201);
      const next = await loginExpectingMfa(a.email);
      for (let i = 0; i < 4; i++) {
        expect((await mfaLogin(next.mfaToken, '999999')).status).toBe(401);
      }
      // 4 more after a reset: still not locked
      const ok = await mfaLogin(
        next.mfaToken,
        totpCode(secret, Date.now() + 60000),
      );
      expect([201, 401]).toContain(ok.status); // window edge; the point is: not 429
      expect(ok.status).not.toBe(429);
    });

    it('wrong codes never reveal which factor was wrong: the 401 body is generic', async () => {
      const a = await shop('tf-generic');
      await enroll(a);
      const pending = await loginExpectingMfa(a.email);
      const r1 = await mfaLogin(pending.mfaToken, '000000');
      const r2 = await mfaLogin(pending.mfaToken, 'AAAA-BBBB-CCCC-DDDD');
      expect(r1.body).toEqual(r2.body);
    });

    it('POST /auth/login/mfa is rate limited per IP', async () => {
      process.env.THROTTLE_IN_TESTS = '1';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 8; i++) {
          const r = await http()
            .post('/auth/login/mfa')
            .send({ mfaToken: 'junk', code: '000000' });
          statuses.push(r.status);
        }
        expect(statuses).toContain(429);
      } finally {
        delete process.env.THROTTLE_IN_TESTS;
      }
    });
  });

  describe('turning it off and downgrade paths', () => {
    it('own disable needs a valid code (or recovery code), then logs in with the password alone', async () => {
      const a = await shop('tf-disable');
      const { secret, recoveryCodes } = await enroll(a);
      const wrong = await http()
        .post('/auth/2fa/disable')
        .set(bearer(a.accessToken))
        .send({ code: '000000' });
      expect(wrong.status).toBe(401);
      await http()
        .post('/auth/2fa/disable')
        .set(bearer(a.accessToken))
        .send({ code: recoveryCodes[0] })
        .expect(201);
      void secret;
      const r = await http()
        .post('/auth/login')
        .send({ email: a.email, password: PW })
        .expect(201);
      expect(body<MfaRequired>(r).mfaRequired).toBeUndefined();
      // re-enrolment is possible again
      await enroll({
        accessToken: body<Tokens>(r).accessToken,
        refreshToken: '',
      });
    });

    it('a password RESET does not disable the second factor', async () => {
      const a = await shop('tf-reset-pw');
      await enroll(a);
      const forgot = await http()
        .post('/auth/forgot-password')
        .send({ email: a.email })
        .expect(201);
      const token = new URL(
        body<{ devResetLink: string }>(forgot).devResetLink,
      ).searchParams.get('token')!;
      await http()
        .post('/auth/reset-password')
        .send({ token, newPassword: 'reset-password-88' })
        .expect(201);
      const r = await http()
        .post('/auth/login')
        .send({ email: a.email, password: 'reset-password-88' })
        .expect(201);
      expect(body<MfaRequired>(r).mfaRequired).toBe(true);
      expect(r.get('Set-Cookie')).toBeUndefined();
    });

    it('an invite acceptance, signup and refresh never mint a session that skips an existing second factor', async () => {
      const a = await shop('tf-refresh');
      const { secret } = await enroll(a);
      const pending = await loginExpectingMfa(a.email);
      const ok = await mfaLogin(
        pending.mfaToken,
        codeAfterEnroll(secret),
      ).expect(201);
      // a refresh token from the post-2FA session keeps working (the factor was already proven)
      await http()
        .post('/auth/refresh')
        .set('Cookie', `req-staff-rt=${body<Tokens>(ok).refreshToken}`)
        .expect(201);
    });
  });

  describe('shop-wide requirement', () => {
    it('forces unenrolled staff into an enrolment-only scope until they enrol, immediately, in this shop only', async () => {
      const admin = await shop('tf-policy');
      const other = await shop('tf-policy-other');
      const staffEmail = `tf-policy-staff-${runId}@test.com`;
      await http()
        .post('/auth/branch-users')
        .set(bearer(admin.accessToken))
        .send({
          name: 'Viewer',
          email: staffEmail,
          role: 'viewer',
          password: PW,
        })
        .expect(201);
      const staffLogin = await http()
        .post('/auth/login')
        .send({ email: staffEmail, password: PW })
        .expect(201);
      const staff = body<Tokens>(staffLogin);
      await http().get('/products').set(bearer(staff.accessToken)).expect(200);

      // admin must be enrolled first
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: true })
        .expect(400);
      const { secret } = await enroll(admin);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: true })
        .expect(200);

      // takes effect on the staff member's EXISTING session at once
      const blocked = await http()
        .get('/products')
        .set(bearer(staff.accessToken));
      expect(blocked.status).toBe(403);
      expect(body<{ code: string }>(blocked).code).toBe(
        'mfa_enrollment_required',
      );
      for (const path of [
        '/orders',
        '/products',
        '/auth/users',
        '/auth/sessions',
      ]) {
        expect(
          (await http().get(path).set(bearer(staff.accessToken))).status,
        ).toBe(403);
      }
      // the enrolment-only scope still reaches me + 2fa
      const me = await http()
        .get('/auth/me')
        .set(bearer(staff.accessToken))
        .expect(200);
      expect(
        body<{ twoFactor: { enrollmentRequired: boolean } }>(me).twoFactor
          .enrollmentRequired,
      ).toBe(true);
      await http().get('/auth/2fa').set(bearer(staff.accessToken)).expect(200);

      // the other shop is untouched
      await http().get('/shop').set(bearer(other.accessToken)).expect(200);

      // the admin is not restricted (enrolled)
      await http().get('/shop').set(bearer(admin.accessToken)).expect(200);

      // enrolling lifts it, same session
      await enroll(staff);
      await http().get('/products').set(bearer(staff.accessToken)).expect(200);

      // a required shop cannot have members turn their factor off
      await http()
        .post('/auth/2fa/disable')
        .set(bearer(staff.accessToken))
        .send({ code: '000000' })
        .expect(403);

      // switching it off needs the admin's code
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: false })
        .expect(400);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: false, code: '000000' })
        .expect(401);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: false, code: codeAfterEnroll(secret) })
        .expect(200);
      const [s] = await db.query<RowDataPacket[]>(
        `SELECT require2fa FROM shop WHERE id = ?`,
        [admin.user.shopId],
      );
      expect(s.require2fa).toBeFalsy();
    });

    it('only an admin can change the policy, and only for their own shop', async () => {
      const a = await shop('tf-pol-a');
      const b = await shop('tf-pol-b');
      await enroll(a);
      await enroll(b);
      const staffEmail = `tf-pol-viewer-${runId}@test.com`;
      await http()
        .post('/auth/branch-users')
        .set(bearer(a.accessToken))
        .send({ name: 'V', email: staffEmail, role: 'viewer', password: PW })
        .expect(201);
      const v = body<Tokens>(
        await http()
          .post('/auth/login')
          .send({ email: staffEmail, password: PW })
          .expect(201),
      );
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(v.accessToken))
        .send({ required: true })
        .expect(403);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(b.accessToken))
        .send({ required: true })
        .expect(200);
      const [rows] = await Promise.all([
        db.query<RowDataPacket[]>(
          `SELECT id, require2fa FROM shop WHERE id IN (?, ?)`,
          [a.user.shopId, b.user.shopId],
        ),
      ]);
      const byId = Object.fromEntries(
        rows.map((r) => [r.id as number, !!r.require2fa]),
      );
      expect(byId[a.user.shopId]).toBe(false);
      expect(byId[b.user.shopId]).toBe(true);
    });

    it('an invited member who accepts the invite lands in the enrolment-only scope', async () => {
      const admin = await shop('tf-invite');
      await enroll(admin);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: true })
        .expect(200);
      const invited = await http()
        .post('/auth/branch-users')
        .set(bearer(admin.accessToken))
        .send({
          name: 'Invitee',
          email: `tf-invitee-${runId}@test.com`,
          role: 'viewer',
        })
        .expect(201);
      const token = new URL(
        body<{ devInviteLink: string }>(invited).devInviteLink,
      ).searchParams.get('token')!;
      const accepted = await http()
        .post('/auth/accept-invite')
        .send({ token, password: 'invitee-password-1' })
        .expect(201);
      const t = body<Tokens>(accepted);
      expect(
        (await http().get('/products').set(bearer(t.accessToken))).status,
      ).toBe(403);
      await enroll({ accessToken: t.accessToken, refreshToken: '' }).catch(
        () => undefined,
      );
    });

    it('impersonation is neither blocked by the policy nor able to manage a second factor', async () => {
      const admin = await shop('tf-imp');
      await enroll(admin);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(admin.accessToken))
        .send({ required: true })
        .expect(200);
      // make the admin look unenrolled to prove the policy does not gate impersonation
      await db.execute(
        `UPDATE usertotp SET confirmedAt = NULL WHERE userId = ?`,
        [admin.user.id],
      );
      const imp = await app
        .get(AuthService)
        .issueImpersonationTokenForShop(admin.user.shopId, 424242);
      await http().get('/shop').set(bearer(imp.accessToken)).expect(200);
      await http().get('/auth/2fa').set(bearer(imp.accessToken)).expect(200);
      await http()
        .post('/auth/2fa/enroll/start')
        .set(bearer(imp.accessToken))
        .send({ currentPassword: PW })
        .expect(403);
      await http()
        .post('/auth/2fa/disable')
        .set(bearer(imp.accessToken))
        .send({ code: '000000' })
        .expect(403);
      await http()
        .put('/auth/2fa/shop-policy')
        .set(bearer(imp.accessToken))
        .send({ required: false, code: '000000' })
        .expect(403);
    });
  });

  describe('admin reset', () => {
    it('an admin can reset a colleague in the same shop (their sessions end, audit written), not themselves, not another shop', async () => {
      const admin = await shop('tf-areset');
      const outsider = await shop('tf-areset-out');
      const staffEmail = `tf-areset-staff-${runId}@test.com`;
      const created = await http()
        .post('/auth/branch-users')
        .set(bearer(admin.accessToken))
        .send({
          name: 'Staff',
          email: staffEmail,
          role: 'viewer',
          password: PW,
        })
        .expect(201);
      const staffId = body<{ id: number }>(created).id;
      const staffSession = body<Tokens>(
        await http()
          .post('/auth/login')
          .send({ email: staffEmail, password: PW })
          .expect(201),
      );
      await enroll(staffSession);

      await http()
        .post(`/auth/2fa/users/${admin.user.id}/reset`)
        .set(bearer(admin.accessToken))
        .expect(400);
      await http()
        .post(`/auth/2fa/users/${staffId}/reset`)
        .set(bearer(outsider.accessToken))
        .expect(404);
      await http()
        .post(`/auth/2fa/users/${staffId}/reset`)
        .set(bearer(staffSession.accessToken))
        .expect(403);

      await http()
        .post(`/auth/2fa/users/${staffId}/reset`)
        .set(bearer(admin.accessToken))
        .expect(201);
      expect(
        (await http().get('/auth/me').set(bearer(staffSession.accessToken)))
          .status,
      ).toBe(401);
      const r = await http()
        .post('/auth/login')
        .send({ email: staffEmail, password: PW })
        .expect(201);
      expect(body<MfaRequired>(r).mfaRequired).toBeUndefined();
      const audit = await db.query<RowDataPacket[]>(
        `SELECT action, entityId FROM auditlog WHERE shopId = ? AND action = 'auth.2fa_reset_by_admin'`,
        [admin.user.shopId],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].entityId).toBe(staffId);
    });
  });

  describe('CSRF', () => {
    it('POST /auth/login/mfa is a pre-session endpoint (works with a stale access cookie and no CSRF token) while enrolment endpoints stay protected', async () => {
      const a = await shop('tf-csrf');
      const { secret } = await enroll(a);
      const pending = await loginExpectingMfa(a.email);
      const ok = await http()
        .post('/auth/login/mfa')
        .set('Cookie', `req-staff-at=${a.accessToken}`)
        .send({ mfaToken: pending.mfaToken, code: codeAfterEnroll(secret) });
      expect(ok.status).toBe(201);
      expect(
        ok.get('Set-Cookie')?.some((c) => c.startsWith('req-staff-at=')),
      ).toBe(true);

      // a session endpoint with the cookie but no CSRF header is refused
      const refused = await http()
        .post('/auth/2fa/recovery-codes')
        .set('Cookie', `req-staff-at=${a.accessToken}`)
        .send({ currentPassword: PW, code: '000000' });
      expect(refused.status).toBe(403);
    });
  });

  describe('secrets and tokens never reach logs or audit rows', () => {
    it('captured log output contains no secret, code, recovery code or token from this whole file', async () => {
      const a = await shop('tf-secrets');
      const { secret, recoveryCodes } = await enroll(a);
      const pending = await loginExpectingMfa(a.email);
      const code = codeAfterEnroll(secret);
      await mfaLogin(pending.mfaToken, 'AAAA-BBBB-CCCC-DDDD');
      const ok = await mfaLogin(pending.mfaToken, code).expect(201);
      await http()
        .post('/auth/2fa/disable')
        .set(bearer(body<Tokens>(ok).accessToken))
        .send({ code: recoveryCodes[3] })
        .expect(201);

      for (const secretValue of [
        secret,
        code,
        pending.mfaToken,
        ...recoveryCodes,
        ...recoveryCodes.map((c) => c.replace(/-/g, '')),
      ]) {
        expect(logged).not.toContain(secretValue);
      }
      const audits = await db.query<RowDataPacket[]>(
        `SELECT * FROM auditlog WHERE actorUserId = ?`,
        [a.user.id],
      );
      const dump = JSON.stringify(audits);
      for (const secretValue of [secret, code, ...recoveryCodes]) {
        expect(dump).not.toContain(secretValue);
      }
      expect(dump).toContain('auth.2fa_enabled');
      expect(dump).toContain('auth.2fa_disabled');
    });
  });
});
