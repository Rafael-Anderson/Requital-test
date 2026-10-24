import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { hmacSha256Hex } from '../src/channels/hmac';

jest.setTimeout(120000);

// F10. The storefront server's own calls (host resolution, SSR reads) arrive from
// loopback and used to share one per-route bucket with every other such call.
// A call signed with INTERNAL_API_SECRET gets its own bucket; anything unsigned,
// forged, expired or signed for another path stays on the client-IP bucket.
// THROTTLE_IN_TESTS=1 turns the limiter back on for this app instance only.
const SECRET = 'e2e-internal-secret-0123456789abcdef0123';
const PATH = '/domains/resolve';
const URL = `${PATH}?host=throttle-probe.invalid`;

function sign(t: number, path = PATH, secret = SECRET, method = 'GET') {
  return `t=${t},sig=${hmacSha256Hex(secret, `${method}\n${path}\n${t}`)}`;
}
const now = () => Math.floor(Date.now() / 1000);

describe('Internal storefront throttle bucket (e2e)', () => {
  let app: INestApplication<App>;
  const prev = {
    t: process.env.THROTTLE_IN_TESTS,
    s: process.env.INTERNAL_API_SECRET,
  };

  const get = (headers: Record<string, string> = {}) =>
    request(app.getHttpServer()).get(URL).set(headers);

  beforeAll(async () => {
    process.env.THROTTLE_IN_TESTS = '1';
    process.env.INTERNAL_API_SECRET = SECRET;
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
    for (const [k, v] of [
      ['THROTTLE_IN_TESTS', prev.t],
      ['INTERNAL_API_SECRET', prev.s],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('exhausts the public bucket, then keeps signed internal calls on their own bucket', async () => {
    for (let i = 0; i < 100; i++) await get().expect(404);
    const limited = await get().expect(429);
    expect(limited.headers['retry-after']).toBeDefined();

    // The public bucket is spent; verified internal calls are unaffected...
    for (let i = 0; i < 90; i++)
      await get({ 'X-Internal-Auth': sign(now()) }).expect(404);
    // ...and are still a bucket, not a bypass.
    for (let i = 0; i < 10; i++)
      await get({ 'X-Internal-Auth': sign(now()) }).expect(404);
    await get({ 'X-Internal-Auth': sign(now()) }).expect(429);
  });

  it('falls back to the client-IP bucket for forged, expired, malformed and wrong-path signatures', async () => {
    const bad = [
      sign(now(), PATH, 'x'.repeat(40)),
      sign(now() - 120),
      sign(now() + 120),
      sign(now(), '/domains/verify'),
      'garbage',
      `t=${now()},sig=${'0'.repeat(64)}`,
    ];
    // the client-IP bucket is already exhausted by the previous test
    for (const header of bad)
      await get({ 'X-Internal-Auth': header }).expect(429);
  });

  it('ignores a client address header unless the signature verified', async () => {
    await get({ 'X-Internal-Client-IP': '198.51.100.77' }).expect(429);
    await get({
      'X-Internal-Auth': 'garbage',
      'X-Internal-Client-IP': '198.51.100.78',
    }).expect(429);
  });

  it('gives each verified forwarded client address its own bucket', async () => {
    const a = {
      'X-Internal-Auth': sign(now()),
      'X-Internal-Client-IP': '203.0.113.10',
    };
    for (let i = 0; i < 100; i++) await get(a).expect(404);
    await get(a).expect(429);
    await get({
      'X-Internal-Auth': sign(now()),
      'X-Internal-Client-IP': '203.0.113.11',
    }).expect(404);
  });

  it('a verified signature does NOT take a mutation or auth route out of the client-IP bucket', async () => {
    // Rotating the forwarded address is exactly what a secret holder could do to
    // get a fresh bucket per request; on /auth/login it must still hit the limit.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set({
          'X-Internal-Auth': sign(now(), '/auth/login', SECRET, 'POST'),
          'X-Internal-Client-IP': `198.51.100.${100 + i}`,
        })
        .send({ email: 'nobody@example.invalid', password: 'x'.repeat(12) });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(10);

    // Same for a token-lookup GET: not an allowlisted route.
    const lookups: number[] = [];
    for (let i = 0; i < 70; i++) {
      const p = '/public/orders/lookup';
      const res = await request(app.getHttpServer())
        .get(`${p}?token=${'A'.repeat(32)}`)
        .set({
          'X-Internal-Auth': sign(now(), p),
          'X-Internal-Client-IP': `198.51.100.${i}`,
        });
      lookups.push(res.status);
    }
    expect(lookups).toContain(429);
  });

  it('verifies nothing when the secret is unset (fail closed)', async () => {
    delete process.env.INTERNAL_API_SECRET;
    try {
      await get({
        'X-Internal-Auth': sign(now()),
        'X-Internal-Client-IP': '203.0.113.12',
      }).expect(429);
    } finally {
      process.env.INTERNAL_API_SECRET = SECRET;
    }
  });
});
