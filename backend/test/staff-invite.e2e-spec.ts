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
  user: { role: string };
}
interface BranchUserResponse {
  id: number;
  email: string;
  devInviteLink?: string;
  devVerificationLink?: string;
}
interface OutletRow {
  id: number;
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

function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

describe('Staff invite flow (e2e)', () => {
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

  it('creating a branch user without a password sends an invite instead of an immediately-usable account', async () => {
    const admin = await signupShop('invite-basic');
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    const email = `invite-basic-staff-${runId}@test.com`;

    const created = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Invited Staff', email, outletId })
      .expect(201);
    const invite = body<BranchUserResponse>(created);
    expect(invite.devInviteLink).toBeTruthy();
    expect(invite.devVerificationLink).toBeUndefined();

    // The account exists but has no password the caller knows — login must
    // fail with literally any guess until the invite is accepted.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(401);
  });

  it('accepting the invite sets the password, verifies the account, and logs the user straight in', async () => {
    const admin = await signupShop('invite-accept');
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    const email = `invite-accept-staff-${runId}@test.com`;

    const created = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Invited Staff', email, outletId })
      .expect(201);
    const token = tokenFromDevLink(
      body<BranchUserResponse>(created).devInviteLink!,
    );

    const accepted = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token, password: 'staffchosenpassword123' })
      .expect(201);
    const pair = body<TokenPair>(accepted);
    expect(pair.accessToken).toBeTruthy();

    // The returned access token works immediately (auto-login).
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .expect(200);
    expect(
      body<{ email: string; emailVerified: boolean }>(me).emailVerified,
    ).toBe(true);

    // And the staff member can now log in independently with their own
    // chosen password.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'staffchosenpassword123' })
      .expect(201);
  });

  it('an invite token is single-use', async () => {
    const admin = await signupShop('invite-once');
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    const created = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Invited Staff',
        email: `invite-once-staff-${runId}@test.com`,
        outletId,
      })
      .expect(201);
    const token = tokenFromDevLink(
      body<BranchUserResponse>(created).devInviteLink!,
    );

    await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token, password: 'firstpassword123' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token, password: 'secondpassword123' })
      .expect(400);
    expect(messageContains(second, 'already been used')).toBe(true);
  });

  it('an expired invite token is rejected', async () => {
    const admin = await signupShop('invite-expired');
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    const created = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Invited Staff',
        email: `invite-expired-staff-${runId}@test.com`,
        outletId,
      })
      .expect(201);
    const token = tokenFromDevLink(
      body<BranchUserResponse>(created).devInviteLink!,
    );

    await prisma.authtoken.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token, password: 'whatever123' })
      .expect(400);
    expect(messageContains(res, 'invalid or has expired')).toBe(true);
  });

  it('a garbage invite token is rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token: 'not-a-real-token', password: 'whatever123' })
      .expect(400);
    expect(messageContains(res, 'invalid or has expired')).toBe(true);
  });

  it('a reset-password token cannot be redeemed via accept-invite (purpose is enforced, not just "any valid token")', async () => {
    const admin = await signupShop('invite-wrong-purpose');
    const forgot = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: admin.email })
      .expect(201);
    const resetToken = tokenFromDevLink(
      body<{ devResetLink: string }>(forgot).devResetLink,
    );

    const res = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .send({ token: resetToken, password: 'whatever123' })
      .expect(400);
    expect(messageContains(res, 'invalid or has expired')).toBe(true);
  });

  it('supplying a password directly still works unchanged — the invite path is opt-in, not forced', async () => {
    const admin = await signupShop('invite-optout');
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    const email = `invite-optout-staff-${runId}@test.com`;

    const created = await request(app.getHttpServer())
      .post('/auth/branch-users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Direct Staff',
        email,
        password: 'directpassword123',
        outletId,
      })
      .expect(201);
    const res = body<BranchUserResponse>(created);
    expect(res.devInviteLink).toBeUndefined();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'directpassword123' })
      .expect(201);
  });
});
