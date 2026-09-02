import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { DnsResolver } from '../src/shop/dns-resolver';
import { CustomDomainVerificationService } from '../src/shop/custom-domain-verification.service';
import type { RowDataPacket } from 'mysql2/promise';

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
}
function body<T>(res: Response): T {
  return res.body as T;
}

// A DnsResolver stand-in the tests drive directly: setTxt() plants the TXT
// records a given host "publishes", clearTxt() removes them. resolveTxt() mirrors
// Node's shape (string[][]) and throws ENOTFOUND for a host with nothing set,
// exactly like the real resolver would for a name with no TXT record.
class FakeDnsResolver {
  private readonly records = new Map<string, string[][]>();
  setTxt(host: string, values: string[]) {
    this.records.set(
      host,
      values.map((v) => [v]),
    );
  }
  clearTxt(host: string) {
    this.records.delete(host);
  }
  resolveTxt(host: string): Promise<string[][]> {
    const r = this.records.get(host);
    if (!r) return Promise.reject(new Error('ENOTFOUND'));
    return Promise.resolve(r);
  }
}

describe('Custom domain ownership verification (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let dns: FakeDnsResolver;
  let verification: CustomDomainVerificationService;
  const runId = Date.now();

  beforeAll(async () => {
    dns = new FakeDnsResolver();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DnsResolver)
      .useValue(dns)
      .compile();
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
    verification = moduleFixture.get(CustomDomainVerificationService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(prefix: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'CD Admin',
        email: `${prefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${prefix} Shop`,
        subdomain: `${prefix}-${runId}`,
      })
      .expect(201);
    const b = body<AuthResponse>(res);
    return {
      token: b.accessToken,
      shopId: b.user.shopId,
      subdomain: `${prefix}-${runId}`,
    };
  }
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function claim(token: string, domain: string) {
    const res = await request(app.getHttpServer())
      .patch('/shop/domain')
      .set(auth(token))
      .send({ type: 'custom', customDomain: domain })
      .expect(200);
    return body<DomainBody>(res).verification!.recordValue;
  }
  async function getDomain(token: string) {
    return body<DomainBody>(
      await request(app.getHttpServer())
        .get('/shop/domain')
        .set(auth(token))
        .expect(200),
    );
  }
  const verify = (token: string) =>
    request(app.getHttpServer()).post('/shop/domain/verify').set(auth(token));

  it('cannot verify a claim without the real DNS TXT record — the check actually hits DNS', async () => {
    const shop = await setupShop('cd-nodns');
    const domain = `cd-nodns-${runId}.example.com`;
    await claim(shop.token, domain);

    // No TXT planted -> verify reports not-verified, claim advances to verifying.
    const r = await verify(shop.token).expect(201);
    expect(body<{ verified: boolean; status: string }>(r).verified).toBe(false);
    expect(body<{ status: string }>(r).status).toBe('verifying');

    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(404);
    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain })
      .expect(404);
  });

  it('resolve-cache (Phase 6): a domain resolved BEFORE it verifies still reflects the verify immediately, not after the TTL', async () => {
    const shop = await setupShop('cd-cache');
    const domain = `cd-cache-${runId}.example.com`;
    const token = await claim(shop.token, domain);

    // Populate the cache with the pre-verify answer (null / 404).
    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(404);

    dns.setTxt(`_requital-verify.${domain}`, [token]);
    await verify(shop.token).expect(201);

    // No waiting for the 30s TTL — verifyClaim invalidated the entry.
    const resolved = await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(200);
    expect(body<{ subdomain: string }>(resolved).subdomain).toBe(
      shop.subdomain,
    );

    // And a disconnect is likewise immediate (updateDomain invalidates).
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set(auth(shop.token))
      .send({ type: 'subdomain' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(404);
  });

  it('two shops race the same domain: both claim, first to prove DNS wins exclusively, loser -> failed + 409', async () => {
    const shopA = await setupShop('cd-race-a');
    const shopB = await setupShop('cd-race-b');
    const domain = `cd-race-${runId}.example.com`;

    const tokenA = await claim(shopA.token, domain);
    const tokenB = await claim(shopB.token, domain);
    expect(tokenA).not.toEqual(tokenB);

    // Only shop A's token is actually published in DNS.
    dns.setTxt(`_requital-verify.${domain}`, [tokenA]);

    const a = await verify(shopA.token).expect(201);
    expect(body<{ verified: boolean }>(a).verified).toBe(true);

    // Domain now routes to shop A.
    const resolved = await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(200);
    expect(body<{ subdomain: string }>(resolved).subdomain).toBe(
      shopA.subdomain,
    );

    // Shop B's verify is rejected and its claim is terminally failed.
    await verify(shopB.token).expect(409);
    expect((await getDomain(shopB.token)).status).toBe('failed');
  });

  it('disconnect stops resolution and cert-eligibility immediately, and rotates the token', async () => {
    const shop = await setupShop('cd-disc');
    const domain = `cd-disc-${runId}.example.com`;
    const token = await claim(shop.token, domain);
    dns.setTxt(`_requital-verify.${domain}`, [token]);
    await verify(shop.token).expect(201);

    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(200);
    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain })
      .expect(200);

    // Disconnect — no sweep tick in between.
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set(auth(shop.token))
      .send({ type: 'subdomain' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(404);
    await request(app.getHttpServer())
      .get('/domains/verify')
      .query({ domain })
      .expect(404);

    const rows = await db.query<RowDataPacket[]>(
      `SELECT customDomain, customDomainStatus, customDomainVerifyToken FROM shop WHERE id = ?`,
      [shop.shopId],
    );
    expect(rows[0].customDomain).toBeNull();
    expect(rows[0].customDomainStatus).toBeNull();
    expect(rows[0].customDomainVerifyToken).toBeNull();
  });

  it('a stale DNS TXT record from a shop that disconnected cannot re-verify a different shop', async () => {
    const shopA = await setupShop('cd-stale-a');
    const shopB = await setupShop('cd-stale-b');
    const domain = `cd-stale-${runId}.example.com`;

    const tokenA = await claim(shopA.token, domain);
    dns.setTxt(`_requital-verify.${domain}`, [tokenA]);
    await verify(shopA.token).expect(201);

    // Shop A leaves — but its TXT record lingers in DNS.
    await request(app.getHttpServer())
      .patch('/shop/domain')
      .set(auth(shopA.token))
      .send({ type: 'subdomain' })
      .expect(200);

    // Shop B claims the now-free domain; it gets its OWN fresh token.
    const tokenB = await claim(shopB.token, domain);
    expect(tokenB).not.toEqual(tokenA);

    // The stale tokenA record is still all that's published.
    const r = await verify(shopB.token).expect(201);
    expect(body<{ verified: boolean }>(r).verified).toBe(false);
    await request(app.getHttpServer())
      .get('/domains/resolve')
      .query({ host: domain })
      .expect(404);
  });

  it('the scheduled sweep terminal-fails a claim past the 48h window (driven directly, no waiting)', async () => {
    const shop = await setupShop('cd-sweepfail');
    const domain = `cd-sweepfail-${runId}.example.com`;
    await claim(shop.token, domain);

    await db.execute(`UPDATE shop SET customDomainClaimedAt = ? WHERE id = ?`, [
      new Date(Date.now() - 49 * 60 * 60 * 1000),
      shop.shopId,
    ]);
    await verification.runSweep();

    expect((await getDomain(shop.token)).status).toBe('failed');
  });

  describe('the public endpoints stay unauthenticated, injection-safe, and (verify) throttled', () => {
    it('/domains/verify and /domains/resolve need no auth', async () => {
      await request(app.getHttpServer())
        .get('/domains/resolve')
        .query({ host: `nobody-${runId}.example.com` })
        .expect(404); // reached the handler (404), not a 401 from a guard
      await request(app.getHttpServer())
        .get('/domains/verify')
        .query({ domain: `nobody-${runId}.example.com` })
        .expect(404);
    });

    it('a SQL-injection-shaped host/domain is treated as a plain string and matches nothing', async () => {
      for (const payload of [
        `x' OR '1'='1`,
        `x'; DROP TABLE shop; --`,
        `x" UNION SELECT subdomain FROM shop --`,
      ]) {
        // Parameterized queries — the payload is matched as a literal hostname,
        // finds no shop, and executes nothing. A successful injection would
        // instead 200 (OR '1'='1' matching a row) or 500 (broken SQL).
        await request(app.getHttpServer())
          .get('/domains/resolve')
          .query({ host: payload })
          .expect(404);
        await request(app.getHttpServer())
          .get('/domains/verify')
          .query({ domain: payload })
          .expect(404);
      }
      // The `shop` table is still there and queryable — the DROP payload did
      // nothing. (An exact before/after row count would race other e2e specs'
      // concurrent signups, so assert the structural invariant instead.)
      const rows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM shop`,
      );
      expect(Number(rows[0].c)).toBeGreaterThan(0);
    });

    it('/domains/verify rate-limits a burst from one IP (throttler is Jest-skipped, so flip NODE_ENV like rate-limiting.e2e-spec.ts)', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'e2e-throttle-check';
      try {
        let sawThrottled = false;
        for (let i = 0; i < 75; i++) {
          const res = await request(app.getHttpServer())
            .get('/domains/verify')
            .query({ domain: `burst-${runId}.example.com` });
          if (res.status === 429) {
            sawThrottled = true;
            break;
          }
        }
        expect(sawThrottled).toBe(true);
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });
});
