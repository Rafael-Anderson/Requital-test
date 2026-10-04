import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// TRUST_PROXY (common/trust-proxy.ts). Supertest connects from 127.0.0.1, so
// that is the "proxy" socket the backend sees here, exactly as Caddy (chain A)
// and the Next rewrite (chain B) look to the backend in production. What the
// "proxy" says about the client travels in X-Forwarded-For.
//
// Throttling is re-enabled for this file only (THROTTLE_IN_TESTS, see
// signup-limits.e2e-spec.ts). Each scenario builds its own app, because the
// setting is read once at init and the throttler store is per app.

const body = <T>(res: Response) => res.body as T;
const runId = Date.now();
let seq = 0;

async function buildApp(trust: string | undefined): Promise<INestApplication<App>> {
  if (trust === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = trust;
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  try {
    await app.init();
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
  return app;
}

// Signs a shop up from `xff` and returns the session list's IP column, which
// is the only place the backend shows what it believed the client's address was.
async function sessionIpFor(
  app: INestApplication<App>,
  headers: Record<string, string | string[]>,
): Promise<string | null> {
  const slug = `e2e-tp-${runId}-${++seq}`;
  let req = request(app.getHttpServer()).post('/auth/signup');
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v as string);
  const signup = await req.send({
    name: 'Trust Proxy Admin',
    email: `${slug}@test.com`,
    password: 'password123',
    shopName: `${slug} Shop`,
    subdomain: slug,
  });
  expect(signup.status).toBe(201);
  const token = body<{ accessToken: string }>(signup).accessToken;
  const sessions = await request(app.getHttpServer())
    .get('/auth/sessions')
    .set('Authorization', `Bearer ${token}`);
  expect(sessions.status).toBe(200);
  const rows = body<Array<{ ip: string | null }>>(sessions);
  expect(rows).toHaveLength(1);
  return rows[0].ip;
}

// Failed logins for an address nobody owns: 401 until the 5/min limit, then 429.
async function loginStatus(
  app: INestApplication<App>,
  headers: Record<string, string | string[]>,
): Promise<number> {
  let req = request(app.getHttpServer()).post('/auth/login');
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v as string);
  const res = await req.send({
    email: `nobody-${runId}-${++seq}@test.com`,
    password: 'not-the-password-1',
  });
  return res.status;
}

async function burst(
  app: INestApplication<App>,
  headers: Record<string, string>,
  n = 5,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await loginStatus(app, headers));
  return out;
}

// An app that unexpectedly starts is closed before the assertion fails, so a
// regression reports a failed test instead of hanging jest on open handles.
async function expectRefused(value: string) {
  let app: INestApplication<App> | undefined;
  try {
    app = await buildApp(value);
  } catch (err) {
    expect((err as Error).message).toMatch(/TRUST_PROXY/);
    return;
  }
  await app.close();
  throw new Error(`TRUST_PROXY=${value} was accepted`);
}

describe('TRUST_PROXY (e2e)', () => {
  const prevThrottle = process.env.THROTTLE_IN_TESTS;
  const prevTrust = process.env.TRUST_PROXY;
  beforeAll(() => {
    process.env.THROTTLE_IN_TESTS = '1';
  });
  afterAll(() => {
    if (prevThrottle === undefined) delete process.env.THROTTLE_IN_TESTS;
    else process.env.THROTTLE_IN_TESTS = prevThrottle;
    if (prevTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrust;
  });

  // The production value for BOTH chains: Caddy overwrites X-Forwarded-For with
  // the client's socket address and (chain B) the Next rewrite passes it
  // through, so the backend's peer is always loopback and the client is the
  // right-most entry that is not loopback.
  describe('TRUST_PROXY=loopback (production)', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      app = await buildApp('loopback');
    });
    afterAll(() => app.close());

    it('chain A/B: the client address Caddy appended is what the session records', async () => {
      expect(await sessionIpFor(app, { 'X-Forwarded-For': '203.0.113.7' })).toBe(
        '203.0.113.7',
      );
    });

    it('a client-supplied entry to the LEFT of the trusted one never chooses the address', async () => {
      expect(
        await sessionIpFor(app, { 'X-Forwarded-For': '6.6.6.6, 203.0.113.50' }),
      ).toBe('203.0.113.50');
    });

    it('extra trusted hops on the right (a proxy that also appends loopback) are skipped, including ::ffff: and ::1 spellings', async () => {
      expect(
        await sessionIpFor(app, {
          'X-Forwarded-For': '203.0.113.51, 127.0.0.1, ::ffff:127.0.0.1, ::1',
        }),
      ).toBe('203.0.113.51');
    });

    it('two X-Forwarded-For header fields are folded and still resolve to the right-most untrusted entry', async () => {
      expect(
        await sessionIpFor(app, {
          'X-Forwarded-For': ['6.6.6.6', '203.0.113.52'],
        }),
      ).toBe('203.0.113.52');
    });

    it('a very long client-supplied list cannot push the real client out of position', async () => {
      const junk = Array.from({ length: 500 }, (_, i) => `10.9.${i % 250}.1`);
      expect(
        await sessionIpFor(app, {
          'X-Forwarded-For': `${junk.join(', ')}, 203.0.113.53`,
        }),
      ).toBe('203.0.113.53');
    });

    it('X-Real-IP, Forwarded and CF-Connecting-IP are never read', async () => {
      expect(
        await sessionIpFor(app, {
          'X-Real-IP': '7.7.7.7',
          Forwarded: 'for=8.8.8.8',
          'CF-Connecting-IP': '9.9.9.9',
        }),
      ).toBe('127.0.0.1');
    });

    it('an IPv6 client is recorded as sent', async () => {
      expect(
        await sessionIpFor(app, { 'X-Forwarded-For': '2001:db8:aa:bb::7' }),
      ).toBe('2001:db8:aa:bb::7');
    });

    it('two clients behind the proxy get separate throttle buckets; the same client is limited', async () => {
      const a = { 'X-Forwarded-For': '203.0.113.101' };
      const b = { 'X-Forwarded-For': '203.0.113.102' };
      expect(await burst(app, a)).toEqual([401, 401, 401, 401, 401]);
      expect(await loginStatus(app, a)).toBe(429);
      // B is untouched by A's limit.
      expect(await loginStatus(app, b)).toBe(401);
    });

    it('a limited client cannot escape by putting different entries to the left of its real address', async () => {
      const real = '203.0.113.103';
      await burst(app, { 'X-Forwarded-For': real });
      expect(await loginStatus(app, { 'X-Forwarded-For': real })).toBe(429);
      for (const spoof of ['1.1.1.1', '2.2.2.2', '127.0.0.1', '203.0.113.104']) {
        expect(
          await loginStatus(app, { 'X-Forwarded-For': `${spoof}, ${real}` }),
        ).toBe(429);
      }
    });

    it('an IPv6 client cannot escape by rotating within its /64, and an IPv4-mapped spelling is the same client as plain IPv4', async () => {
      const mk = (ip: string) => ({ 'X-Forwarded-For': ip });
      expect(await burst(app, mk('2001:db8:7:7:1::1'))).toEqual([
        401, 401, 401, 401, 401,
      ]);
      expect(await loginStatus(app, mk('2001:db8:7:7:ffff::9'))).toBe(429);
      // A different /64 is a different client.
      expect(await loginStatus(app, mk('2001:db8:7:8::1'))).toBe(401);
      await burst(app, mk('203.0.113.105'));
      expect(await loginStatus(app, mk('::ffff:203.0.113.105'))).toBe(429);
    });
  });

  // Where the peer is NOT in the trusted list the header is attacker data.
  // Here the test client (127.0.0.1) is deliberately outside the list: it
  // models a request that reached the backend without coming through the
  // proxy (the port reachable directly).
  describe.each([
    ['unset', undefined],
    ['a list that does not contain the peer', '203.0.113.0/24'],
  ])('TRUST_PROXY %s: the header is ignored', (_label, value) => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      app = await buildApp(value);
    });
    afterAll(() => app.close());

    it('the session records the socket address, not the forwarded one', async () => {
      expect(await sessionIpFor(app, { 'X-Forwarded-For': '203.0.113.7' })).toBe(
        '127.0.0.1',
      );
    });

    it('rotating X-Forwarded-For does not buy a fresh throttle bucket', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push(
          await loginStatus(app, { 'X-Forwarded-For': `198.51.100.${i + 1}` }),
        );
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });
  });

  // If the API host ever sits behind Cloudflare, the list adds its ranges so
  // the edge address is skipped too: the client is still the right-most entry
  // that is neither loopback nor Cloudflare.
  describe('TRUST_PROXY=loopback plus a CDN range', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      app = await buildApp('loopback,173.245.48.0/20,2400:cb00::/32');
    });
    afterAll(() => app.close());

    it('skips the edge address and ignores what the client put to the left', async () => {
      expect(
        await sessionIpFor(app, {
          'X-Forwarded-For': '6.6.6.6, 203.0.113.60, 173.245.48.5',
        }),
      ).toBe('203.0.113.60');
    });

    it('only the right-most untrusted entry counts: whatever stands left of it is ignored, whatever stands right of it must be a trusted hop', async () => {
      expect(
        await sessionIpFor(app, {
          'X-Forwarded-For': '203.0.113.61, 6.6.6.6',
        }),
      ).toBe('6.6.6.6');
    });
  });

  // Strict validation: the app refuses to start rather than guess. The same
  // check runs earlier in main.ts via validateEnv with a readable message.
  describe('invalid values are rejected at init', () => {
    it.each(['true', 'TRUE', 'false', '*', 'all', '0', '11', '-1', '1.5'])(
      'refuses %s',
      (value) => expectRefused(value),
    );
    it.each([
      '0.0.0.0/0',
      '::/0',
      '10.0.0.0/7',
      '203.0.113.0/33',
      'not-an-ip',
      'loopback,,',
      'loopback;10.0.0.1',
      '1.2.3.4/8/9',
    ])('refuses %s', (value) => expectRefused(value));
  });
});

