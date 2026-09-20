import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface SignupResponse {
  accessToken: string;
  devVerificationLink?: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// STF-14. An unverified merchant keeps full access to their own admin - they
// can log in, build a catalog, set up outlets, edit their theme - but cannot
// take the three outward-facing / credential-bearing actions gated by
// VerifiedEmailGuard. Publishing (and therefore taking real orders) was
// already gated before this, by ShopService.getPublishReadiness.
describe('Email verification gate (e2e)', () => {
  let app: INestApplication<App>;
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
  });

  afterAll(async () => {
    await app.close();
  });

  async function signup(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Verification Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    return body<SignupResponse>(res);
  }

  describe('while unverified', () => {
    let token: string;
    let devLink: string | undefined;
    let outletId: number;
    let collectionId: number;

    beforeAll(async () => {
      const session = await signup('e2e-verif-gate');
      token = session.accessToken;
      devLink = session.devVerificationLink;
      // A 'branch' invite is outlet-pinned (CreateBranchUserDto), so the
      // invite calls below need the default outlet signup created.
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      outletId = body<{ id: number }[]>(outlets)[0].id;
      const collection = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Gate Test Collection' })
        .expect(201);
      collectionId = body<{ id: number }>(collection).id;
    });

    it('refuses to connect a payment gateway, naming the reason', async () => {
      const res = await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${token}`)
        .send({ enabled: true })
        .expect(403);
      expect(body<{ message: string }>(res).message).toMatch(
        /verify your email/i,
      );
      expect(body<{ message: string }>(res).message).toContain(
        'connecting a payment gateway',
      );
    });

    it('refuses to invite staff', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Branch Person',
          email: `branch-${runId}@test.com`,
          role: 'branch',
          outletId,
        })
        .expect(403);
      expect(body<{ message: string }>(res).message).toContain(
        'inviting staff',
      );
    });

    it('refuses to connect a custom domain', async () => {
      const res = await request(app.getHttpServer())
        .patch('/shop/domain')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'custom', customDomain: `shop-${runId}.example.com` })
        .expect(403);
      expect(body<{ message: string }>(res).message).toContain(
        'connecting a custom domain',
      );
    });

    // The gate is on connecting, not on the endpoint. Switching back to a
    // plain subdomain is a de-escalation, and locking someone out of it would
    // be a trap rather than a protection.
    it('still allows switching back to a plain subdomain', async () => {
      await request(app.getHttpServer())
        .patch('/shop/domain')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'subdomain' })
        .expect(200);
    });

    // The whole point of the design: no lockout. If these started 403ing, a
    // merchant with a bounced verification email would be stranded.
    it('leaves the ordinary admin fully usable', async () => {
      await request(app.getHttpServer())
        .get('/shop')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Unverified Product',
          price: 10,
          thumbnail: 'https://placehold.co/400x400.png',
          sku: `UNVERIF-${runId}`,
          collectionIds: [collectionId],
        });
      expect(created.status).toBe(201);
      await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // Reading payment settings stays open so the page still renders; only
      // the write is gated.
      await request(app.getHttpServer())
        .get('/payment-settings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('lets the same actions through once the email is verified', async () => {
      await verifySignupEmail(app.getHttpServer(), devLink);

      await request(app.getHttpServer())
        .patch('/payment-settings/stripe')
        .set('Authorization', `Bearer ${token}`)
        .send({ enabled: true })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Branch Person',
          email: `branch-ok-${runId}@test.com`,
          role: 'branch',
          outletId,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/shop/domain')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'custom', customDomain: `shop-ok-${runId}.example.com` })
        .expect(200);
    });

    // Verification is re-read from the DB on every gated request rather than
    // taken off the token, so no re-login is needed. The token used above was
    // minted BEFORE verification and still works.
    it('did not require a new session to take effect', () => {
      expect(token).toBeTruthy();
    });
  });
});
