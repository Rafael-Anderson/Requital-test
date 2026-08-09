import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashToken } from '../src/common/token-hash';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
interface SignupResponse extends TokenPair {
  user: { role: string; emailVerified: boolean };
  devVerificationLink?: string;
}
interface ErrorBody {
  message: string | string[];
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}

function body<T>(res: Response): T {
  return res.body as T;
}

function tokenFromDevLink(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

describe('Auth security: refresh rotation, password reset, email verification, permissions (e2e)', () => {
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

  describe('refresh token rotation + reuse detection', () => {
    it('a fresh refresh token exchanges for a new pair, and the new access token works', async () => {
      const signup = await signupShop('refresh-basic');
      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(201);
      const pair = body<TokenPair>(refreshed);
      // Not asserting accessToken !== the original here: two JWTs signed
      // with the same payload within the same one-second `iat` are
      // byte-identical, which a fast test can easily hit — the guarantee
      // that actually matters (a new access token that works) is checked
      // below via /auth/me. refreshToken is a fresh random value every
      // time regardless of timing, so that inequality is the real check.
      expect(pair.refreshToken).not.toBe(signup.refreshToken);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${pair.accessToken}`)
        .expect(200);
    });

    it('presenting an already-rotated refresh token a second time is rejected (reuse detected)', async () => {
      const signup = await signupShop('refresh-reuse');
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(201);

      const reuse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(401);
      expect(messageContains(reuse, 'reuse detected')).toBe(true);
    });

    it('reuse detection revokes the whole family — the token issued by the first rotation is dead too', async () => {
      const signup = await signupShop('refresh-family');
      const firstRefresh = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(201);
      const secondPair = body<TokenPair>(firstRefresh);

      // Replaying the original (now-rotated) token triggers reuse detection...
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(401);

      // ...which must have revoked secondPair.refreshToken too, even though
      // it was never itself reused — same family, same session.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: secondPair.refreshToken })
        .expect(401);
    });

    it('an unknown refresh token is rejected without a reuse-detection side effect', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token — it can no longer be redeemed afterward', async () => {
      const signup = await signupShop('logout');
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: signup.refreshToken })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(401);
    });

    it('is idempotent — logging out twice, or with an unknown token, still reports success', async () => {
      const signup = await signupShop('logout-idempotent');
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: signup.refreshToken })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: signup.refreshToken })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: 'never-existed' })
        .expect(201);
    });
  });

  describe('email verification gates Change Password', () => {
    it('rejects change-password for an unverified account', async () => {
      const signup = await signupShop('unverified');
      const res = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${signup.accessToken}`)
        .send({ currentPassword: 'password123', newPassword: 'newpassword123' })
        .expect(403);
      expect(messageContains(res, 'Verify your email')).toBe(true);
    });

    it('allows change-password once the account is verified via the emailed (dev-stubbed) link', async () => {
      const signup = await signupShop('verified');
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: tokenFromDevLink(signup.devVerificationLink!) })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${signup.accessToken}`)
        .send({ currentPassword: 'password123', newPassword: 'newpassword123' })
        .expect(201);
    });

    it('a verification token is single-use', async () => {
      const signup = await signupShop('verify-once');
      const token = tokenFromDevLink(signup.devVerificationLink!);
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token })
        .expect(400);
      expect(messageContains(second, 'already been used')).toBe(true);
    });

    it('resend-verification is a no-op (not an error) once already verified', async () => {
      const signup = await signupShop('resend-after-verified');
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: tokenFromDevLink(signup.devVerificationLink!) })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${signup.accessToken}`)
        .expect(201);
      expect(body<{ alreadyVerified: boolean }>(res).alreadyVerified).toBe(
        true,
      );
    });

    it('changing the password revokes every existing refresh token', async () => {
      const signup = await signupShop('pwchange-revokes');
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: tokenFromDevLink(signup.devVerificationLink!) })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${signup.accessToken}`)
        .send({ currentPassword: 'password123', newPassword: 'newpassword123' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(401);
    });
  });

  describe('password reset flow', () => {
    it('forgot-password does not reveal whether the email exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: `no-such-user-${runId}@test.com` })
        .expect(201);
      expect(body<{ success: boolean; devResetLink?: string }>(res)).toEqual({
        success: true,
      });
    });

    it('a garbage reset token is rejected', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'not-a-real-token', newPassword: 'whatever123' })
        .expect(400);
      expect(messageContains(res, 'invalid or has expired')).toBe(true);
    });

    it('a valid reset token changes the password, is single-use, and revokes existing sessions', async () => {
      const signup = await signupShop('reset-flow');
      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const resetLink = body<{ devResetLink: string }>(forgot).devResetLink;
      expect(resetLink).toBeTruthy();
      const token = tokenFromDevLink(resetLink);

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'brandnewpassword123' })
        .expect(201);

      // Old password no longer works, new one does.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: signup.email, password: 'password123' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: signup.email, password: 'brandnewpassword123' })
        .expect(201);

      // Single-use: the same token can't be redeemed again.
      const secondAttempt = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'yetanotherpassword123' })
        .expect(400);
      expect(messageContains(secondAttempt, 'already been used')).toBe(true);

      // The refresh token issued at signup must have been revoked by the reset.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: signup.refreshToken })
        .expect(401);
    });

    it('an expired reset token is rejected', async () => {
      const signup = await signupShop('reset-expired');
      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: signup.email })
        .expect(201);
      const token = tokenFromDevLink(
        body<{ devResetLink: string }>(forgot).devResetLink,
      );

      // Backdate this specific token's expiry directly — faster and more
      // deterministic than actually waiting out the real 30-minute window.
      // Scoped by tokenHash (not just purpose) so this can never backdate a
      // different test's still-live token if e2e files ever run concurrently.
      await prisma.authtoken.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, newPassword: 'whatever123' })
        .expect(400);
      expect(messageContains(res, 'invalid or has expired')).toBe(true);
    });
  });

  describe('branch users cannot reach admin-only endpoints via the API directly', () => {
    let adminToken: string;
    let branchToken: string;

    beforeAll(async () => {
      const signup = await signupShop('branch-perms');
      adminToken = signup.accessToken;

      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const outletId = body<OutletRow[]>(outlets)[0].id;

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `branch-perms-employee-${runId}@test.com`,
          password: 'password123',
          outletId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `branch-perms-employee-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      branchToken = body<TokenPair>(login).accessToken;
    });

    it('GET /shop is rejected for a branch user (403), and succeeds for the admin — proves this is role-based, not just broken', async () => {
      await request(app.getHttpServer())
        .get('/shop')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('PATCH /shop is rejected for a branch user', async () => {
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Hijacked Shop Name' })
        .expect(403);
    });

    it('GET /auth/users is rejected for a branch user', async () => {
      await request(app.getHttpServer())
        .get('/auth/users')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });

    it('POST /auth/branch-users (creating another branch account) is rejected for a branch user', async () => {
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({
          name: 'Sneaky New Branch User',
          email: `sneaky-${runId}@test.com`,
          password: 'password123',
          outletId: body<OutletRow[]>(outlets)[0].id,
        })
        .expect(403);
    });

    // Structure (name/price/images/collection tree) is admin-only, same as
    // Shop/Users/Outlets/DeliveryZones — this was the gap flagged in the
    // prior audit ([FINDING] tests here previously asserted branch access
    // *worked*; now that it's closed, they assert the opposite).
    it('a branch user CANNOT create, edit, or delete a collection — admin can', async () => {
      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Admin collection ${runId}` })
        .expect(201);
      const collectionId = body<IdRow>(created).id;

      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: `Branch-attempted collection ${runId}` })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Renamed by branch user' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);

      // Branch reads still work — only writes are gated.
      await request(app.getHttpServer())
        .get('/collections')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);
    });

    it('a branch user CANNOT create, structurally edit, or delete a product — admin can', async () => {
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Admin collection for product test ${runId}` })
        .expect(201);
      const collectionId = body<IdRow>(collection).id;

      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({
          name: 'Branch-attempted product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `BRANCH-DENIED-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(403);

      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Admin-created product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `ADMIN-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(product).id;

      await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Renamed by branch user' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);

      // Admin can still do all of it.
      await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed by admin' })
        .expect(200);
    });

    it('a branch user CAN toggle product availability — that stays open, unlike structural edits', async () => {
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Availability test collection ${runId}` })
        .expect(201);
      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Availability test product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `AVAIL-${runId}`,
          collectionIds: [body<IdRow>(collection).id],
        })
        .expect(201);
      const productId = body<IdRow>(product).id;

      const res = await request(app.getHttpServer())
        .patch(`/products/${productId}/availability`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ status: 'Unavailable' })
        .expect(200);
      expect(body<{ status: string }>(res).status).toBe('Unavailable');
    });

    it("the availability endpoint's DTO rejects extra fields — a branch request can't smuggle a name/price change through it", async () => {
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `DTO-splitting test collection ${runId}` })
        .expect(201);
      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'DTO-splitting test product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `DTOSPLIT-${runId}`,
          collectionIds: [body<IdRow>(collection).id],
        })
        .expect(201);
      const productId = body<IdRow>(product).id;

      // whitelist:true + forbidNonWhitelisted:true globally means an
      // unrecognized property on this DTO is a 400, not a silently-dropped
      // field — so this isn't just "the field is ignored", it's rejected
      // outright.
      const res = await request(app.getHttpServer())
        .patch(`/products/${productId}/availability`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({
          status: 'Unavailable',
          name: 'Sneaky rename attempt',
          price: 1,
        })
        .expect(400);
      expect(messageContains(res, 'should not exist')).toBe(true);

      // Confirm the product really is untouched — no partial application.
      const untouched = await request(app.getHttpServer())
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<{ name: string; price: string }>(untouched).name).toBe(
        'DTO-splitting test product',
      );
    });

    it('the stock bulk-adjust endpoint stays open to branch users (day-to-day inventory, not catalog structure)', async () => {
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Stock test collection ${runId}` })
        .expect(201);
      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Stock test product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `STOCK-${runId}`,
          trackInventory: true,
          collectionIds: [body<IdRow>(collection).id],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({
          adjustments: [{ productId: body<IdRow>(product).id, delta: 5 }],
        })
        .expect(200);
    });
  });
});
