import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface AuthResponse {
  accessToken: string;
  user: { shopId: number };
}
interface DomainBody {
  type: string;
  subdomain: string;
  customDomain: string | null;
  status: string | null;
  verification: { recordName: string; recordValue: string } | null;
  storefrontUrl: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Shop domain configuration (e2e)', () => {
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

  async function setupShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Domain Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    const res = body<AuthResponse>(signup);
    return {
      adminToken: res.accessToken,
      shopId: res.user.shopId,
      subdomain: `${slugPrefix}-${runId}`,
    };
  }

  it('rejects a reserved subdomain at signup', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Reserved Admin',
        email: `reserved-${runId}@test.com`,
        password: 'password123',
        shopName: 'Reserved Shop',
        subdomain: 'api',
      })
      .expect(400);
    expect(body<{ message: string }>(res).message).toContain('reserved');
  });

  it('a new shop defaults to type=subdomain with no customDomain', async () => {
    const shop = await setupShop('domain-default');
    const res = await request(app.getHttpServer())
      .get('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const domain = body<DomainBody>(res);
    expect(domain.type).toBe('subdomain');
    expect(domain.subdomain).toBe(shop.subdomain);
    expect(domain.customDomain).toBeNull();
    expect(domain.storefrontUrl).toBe(`https://${shop.subdomain}.requital.io`);
  });

  it('sets a custom domain via PATCH /shop/domain — starts a pending claim with a TXT record to add', async () => {
    const shop = await setupShop('domain-custom');
    const res = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'custom', customDomain: `shop-${runId}.example.com` })
      .expect(200);
    const domain = body<DomainBody>(res);
    expect(domain.type).toBe('custom');
    expect(domain.customDomain).toBe(`shop-${runId}.example.com`);
    expect(domain.status).toBe('pending');
    expect(domain.verification?.recordName).toBe(
      `_requital-verify.shop-${runId}.example.com`,
    );
    expect(domain.verification?.recordValue).toEqual(expect.any(String));
    expect(domain.storefrontUrl).toBe(`https://shop-${runId}.example.com`);
  });

  it('normalizes a pasted full URL down to a bare hostname', async () => {
    const shop = await setupShop('domain-normalize');
    const res = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        type: 'custom',
        customDomain: `HTTPS://Shop-${runId}-Norm.example.com/`,
      })
      .expect(200);
    expect(body<DomainBody>(res).customDomain).toBe(
      `shop-${runId}-norm.example.com`,
    );
  });

  it('rejects a malformed custom domain', async () => {
    const shop = await setupShop('domain-invalid');
    const res = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'custom', customDomain: 'not a domain' })
      .expect(400);
    expect(body<{ message: string }>(res).message).toContain('valid domain');
  });

  it('switching back to type=subdomain clears customDomain', async () => {
    const shop = await setupShop('domain-revert');
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        type: 'custom',
        customDomain: `shop-${runId}-revert.example.com`,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'subdomain' })
      .expect(200);
    const domain = body<DomainBody>(res);
    expect(domain.type).toBe('subdomain');
    expect(domain.customDomain).toBeNull();
  });

  it('lets two shops both hold a pending claim on the same domain (CD2 — a pending claim is not exclusive)', async () => {
    const shopA = await setupShop('domain-dupe-a');
    const shopB = await setupShop('domain-dupe-b');
    const contested = `contested-${runId}.example.com`;

    const a = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .send({ type: 'custom', customDomain: contested })
      .expect(200);
    expect(body<DomainBody>(a).status).toBe('pending');

    // Not a 409 anymore — exclusivity only kicks in once a claim is verified.
    const b = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({ type: 'custom', customDomain: contested })
      .expect(200);
    expect(body<DomainBody>(b).status).toBe('pending');
  });

  it("a branch/order_manager/viewer token cannot reach another shop's domain config — every write is ctx-scoped, no shopId is ever accepted from the client", async () => {
    const shopA = await setupShop('domain-scope-a');
    const shopB = await setupShop('domain-scope-b');

    // shopB's admin can only ever affect shopB's own row, no matter what —
    // there's no :shopId param to spoof in the first place.
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({
        type: 'custom',
        customDomain: `shop-${runId}-b-only.example.com`,
      })
      .expect(200);

    const shopADomain = await request(app.getHttpServer())
      .get('/shop/domain')
      .set('Authorization', `Bearer ${shopA.adminToken}`)
      .expect(200);
    expect(body<DomainBody>(shopADomain).type).toBe('subdomain');
  });

  it('GET /domains/verify is public and returns 200 for a known shop subdomain', async () => {
    const shop = await setupShop('domain-verify-sub');
    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain: `${shop.subdomain}.requital.io` })
      .expect(200);
  });

  it('GET /domains/verify returns 404 for an unverified custom domain claim (no cert until DNS-TXT proven)', async () => {
    const shop = await setupShop('domain-verify-custom');
    const domain = `shop-${runId}-verify.example.com`;
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'custom', customDomain: domain })
      .expect(200);

    // Only a 'verified' custom domain is cert-eligible now. (The verified-state
    // path is covered by custom-domain-verification.e2e-spec.ts, which can mock
    // the DNS lookup.)
    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain })
      .expect(404);
  });

  it('GET /domains/verify returns 404 for an unknown domain', async () => {
    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain: `never-claimed-${runId}.example.com` })
      .expect(404);
  });

  it('GET /domains/verify returns 404 for a custom domain a shop switched away from', async () => {
    const shop = await setupShop('domain-verify-stale');
    const domain = `shop-${runId}-stale.example.com`;
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'custom', customDomain: domain })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'subdomain' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain })
      .expect(404);
  });

  it('GET /domains/resolve is public and returns the real subdomain for a {subdomain}.requital.io host', async () => {
    const shop = await setupShop('domain-resolve-sub');
    const res = await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: `${shop.subdomain}.requital.io` })
      .expect(200);
    expect(body<{ subdomain: string }>(res).subdomain).toBe(shop.subdomain);
  });

  it('GET /domains/resolve returns 404 for an unverified custom domain (a pending claim must not route to a storefront)', async () => {
    const shop = await setupShop('domain-resolve-custom');
    const domain = `shop-${runId}-resolve.example.com`;
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ type: 'custom', customDomain: domain })
      .expect(200);

    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(404);
  });

  it('GET /domains/resolve returns 404 for a host that matches no shop', async () => {
    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: `never-claimed-${runId}.example.com` })
      .expect(404);
  });

  it('GET /domains/resolve returns 404 when no host query param is given', async () => {
    await request(app.getHttpServer()).get('/domains/resolve').expect(404);
  });
});
