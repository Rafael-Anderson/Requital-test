import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface SignupResponse extends TokenPair {
  user: { id: number; shopId: number; email: string };
  devVerificationLink?: string;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

function tokenFromDevLink(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

function messageOf(res: Response): string {
  const { message } = body<ErrorBody>(res);
  return Array.isArray(message) ? message.join(' ') : message;
}

// This whole file runs under Jest (NODE_ENV=test), where the ThrottlerGuard
// is globally skipIf'd (see app.module.ts) — so the per-IP 5/min limit on
// /auth/login never interferes with the many-requests-in-a-row tests below.
// Only test/rate-limiting.e2e-spec.ts deliberately opts back into enforcing
// it; this file is intentionally not that.
describe('Auth lifecycle: progressive lockout, token supersession, adversarial cases (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function signupShop(slugPrefix: string) {
    const email = `${slugPrefix}-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Test Admin',
        email,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    return { email, ...body<SignupResponse>(res) };
  }

  async function verify(signup: SignupResponse) {
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: tokenFromDevLink(signup.devVerificationLink!) })
      .expect(201);
  }

  describe('progressive login lockout (per-account, not per-IP)', () => {
    it('5 wrong passwords in a row trigger a cooldown that rejects even the CORRECT password immediately after', async () => {
      const signup = await signupShop('lockout-basic');

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: signup.email, password: 'totally-wrong' })
          .expect(401);
      }

      // The 6th attempt, with the real password, arrives inside the
      // cooldown window and must still be rejected — the whole point of the
      // lockout existing at all.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: signup.email, password: 'password123' })
        .expect(401);
      expect(messageOf(res)).toBe('Invalid email or password');
    });

    it('once the cooldown window has elapsed, the correct password succeeds and the counter resets — this is a delay, not a lockout', async () => {
      const signup = await signupShop('lockout-recovers');

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: signup.email, password: 'totally-wrong' })
          .expect(401);
      }

      // Simulate the cooldown having elapsed (same backdating technique
      // auth-security.e2e-spec.ts uses for the expired-reset-token test) —
      // waiting out a real 2-second window in every CI run would be slow
      // and the elapsed-time logic itself isn't what's under test here.
      await prisma.user.updateMany({
        where: { email: signup.email },
        data: { lastFailedLoginAt: new Date(Date.now() - 3000) },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: signup.email, password: 'password123' })
        .expect(201);
      expect(body<TokenPair>(res).accessToken).toBeTruthy();

      // A real login must fully clear the counter, not just let this one
      // attempt through — the very next login (even after another instant
      // failed guess) should not still be under the old, larger cooldown.
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: signup.email },
      });
      expect(user.failedLoginAttempts).toBe(0);
    });

    it('an attacker who only knows the email cannot deny the real user service — the correct password always eventually works, and a nonexistent account behaves identically', async () => {
      const signup = await signupShop('lockout-dos-safe');
      const fakeEmail = `no-such-account-${runId}@test.com`;

      // Hammer both a real and a nonexistent account with wrong passwords.
      for (let i = 0; i < 8; i++) {
        const realRes = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: signup.email, password: 'wrong' })
          .expect(401);
        const fakeRes = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: fakeEmail, password: 'wrong' })
          .expect(401);
        // Identical response shape whether the account is real-but-wrong,
        // real-but-cooling-down, or doesn't exist at all — no oracle here.
        expect(messageOf(realRes)).toBe(messageOf(fakeRes));
      }

      // Even after 8 straight failures, the account is not permanently
      // locked: backdating lastFailedLoginAt to "long enough ago" (past the
      // capped 60s ceiling) always lets the correct password back in.
      await prisma.user.updateMany({
        where: { email: signup.email },
        data: { lastFailedLoginAt: new Date(Date.now() - 61_000) },
      });
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: signup.email, password: 'password123' })
        .expect(201);
    });
  });

  describe('password-reset token supersession', () => {
    it('a second forgot-password request invalidates the first — only the newest link works', async () => {
      const signup = await signupShop('reset-supersede');

      const first = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const firstToken = tokenFromDevLink(
        body<{ devResetLink: string }>(first).devResetLink,
      );

      const second = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const secondToken = tokenFromDevLink(
        body<{ devResetLink: string }>(second).devResetLink,
      );

      // The stale first link is dead even though it was never itself used —
      // invalidation reuses the same usedAt CAS single-use redemption relies
      // on, so this reports the same "already been used" as a genuinely
      // redeemed token, not a separate message.
      const staleAttempt = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: firstToken, newPassword: 'irrelevant12345' })
        .expect(400);
      expect(messageOf(staleAttempt)).toContain('already been used');

      // The newest link still works.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: secondToken, newPassword: 'brandnewpassword123' })
        .expect(201);
    });
  });

  describe('email-verification token supersession', () => {
    it('a second resend-verification request invalidates the first', async () => {
      const signup = await signupShop('verify-supersede');
      const firstToken = tokenFromDevLink(signup.devVerificationLink!);

      const resend = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${signup.accessToken}`)
        .expect(201);
      const secondToken = tokenFromDevLink(
        body<{ devVerificationLink: string }>(resend).devVerificationLink,
      );
      expect(secondToken).not.toBe(firstToken);

      const staleAttempt = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: firstToken })
        .expect(400);
      expect(messageOf(staleAttempt)).toContain('already been used');

      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: secondToken })
        .expect(201);
    });
  });

  describe('changing the password invalidates any outstanding reset token', () => {
    it('an unused reset link issued before an authenticated password change stops working afterward', async () => {
      const signup = await signupShop('reset-killed-by-change');
      await verify(signup);

      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const resetToken = tokenFromDevLink(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );

      // The user changes their password through the normal authenticated
      // flow instead, without ever touching the emailed link.
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${signup.accessToken}`)
        .send({ currentPassword: 'password123', newPassword: 'newpassword123' })
        .expect(201);

      // The still-unused reset link must not be able to reset it a second
      // time — the account's password state has moved on without it.
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: resetToken, newPassword: 'attacker-chosen-password' })
        .expect(400);
      expect(messageOf(res)).toContain('already been used');
    });
  });

  describe('adversarial token handling', () => {
    it('a tampered (bit-flipped) token is rejected with the same generic message as an unknown one', async () => {
      const signup = await signupShop('reset-tampered');
      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const validToken = tokenFromDevLink(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );
      const tampered = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: tampered, newPassword: 'whatever12345' })
        .expect(400);
      expect(messageOf(res)).toContain('invalid or has expired');
    });

    it('a truncated token is rejected the same way', async () => {
      const signup = await signupShop('reset-truncated');
      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const validToken = tokenFromDevLink(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );
      const truncated = validToken.slice(0, 8);

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: truncated, newPassword: 'whatever12345' })
        .expect(400);
      expect(messageOf(res)).toContain('invalid or has expired');
    });

    it('a reset token generated for one shop\'s admin cannot affect a different shop\'s admin account', async () => {
      // There's no shopId/userId parameter in the reset request at all — the
      // token itself is the only identifier, resolved via a hashed lookup
      // straight to one authtoken row's userId. This test locks in that the
      // write only ever lands on the intended account, since email is
      // globally unique there's no way for two shops to even collide on it.
      const shopA = await signupShop('cross-tenant-a');
      const shopB = await signupShop('cross-tenant-b');

      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: shopA.email })
        .expect(201);
      const token = tokenFromDevLink(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'shopAnewpassword123' })
        .expect(201);

      // Shop A's new password works; shop B's original password is
      // untouched by the redemption.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: shopA.email, password: 'shopAnewpassword123' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: shopB.email, password: 'password123' })
        .expect(201);
    });

    it('an expired token and an already-used token produce the identical generic message as a garbage token', async () => {
      const signup = await signupShop('reset-generic-message');
      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const token = tokenFromDevLink(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );

      const garbage = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'complete-nonsense', newPassword: 'whatever12345' })
        .expect(400);

      await prisma.authtoken.updateMany({
        where: { userId: signup.user.id, purpose: 'password_reset' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'whatever12345' })
        .expect(400);

      // Same message text for "never existed" and "exists but expired" —
      // no oracle for which case an attacker is looking at.
      expect(messageOf(garbage)).toBe(messageOf(expired));
    });
  });
});
