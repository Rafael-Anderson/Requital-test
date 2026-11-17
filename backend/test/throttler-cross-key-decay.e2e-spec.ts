import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Regression for a defect in @nestjs/throttler 6.5.0's in-memory storage: the
// timers that age out old hits were filed under the throttler NAME
// ("default"), not under the visitor+route key, so when ANY visitor's block
// ended and they came back, resetBlockdRequest cancelled the pending timers of
// EVERY visitor on EVERY route. Their hit counts then stopped decaying until
// they were blocked themselves. 6.6.0+ files expiries per key.
//
// The scenario: visitor A exhausts route A and is blocked; while A is blocked,
// visitor B uses route B a few times; A's block ends and A comes back; once
// B's hits are older than the window, B's count must be back to zero.
//
// Throttling is re-enabled for this file only (THROTTLE_IN_TESTS, see
// signup-limits.e2e-spec.ts), and TRUST_PROXY=loopback lets X-Forwarded-For
// name the two visitors (see trust-proxy.e2e-spec.ts). Only Date and
// setTimeout/clearTimeout are faked, so the 60 s windows pass instantly: 6.5.0
// decays hits with setTimeout, 6.6.0+ with Date.now, and both are covered.
// The two routes never sleep and never touch the database:
//   A: GET /public/orders/lookup with no token (60/min, answered before any
//      query), B: GET /health (the 100/min default).

const VISITOR_A = '203.0.113.10';
const VISITOR_B = '203.0.113.20';

describe('throttler: one visitor coming back from a block does not freeze other visitors (e2e)', () => {
  let app: INestApplication<App>;
  const prevThrottle = process.env.THROTTLE_IN_TESTS;
  const prevTrust = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.THROTTLE_IN_TESTS = '1';
    process.env.TRUST_PROXY = 'loopback';
    const moduleFixture = await Test.createTestingModule({
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
    jest.useRealTimers();
    await app.close();
    if (prevThrottle === undefined) delete process.env.THROTTLE_IN_TESTS;
    else process.env.THROTTLE_IN_TESTS = prevThrottle;
    if (prevTrust === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prevTrust;
  });

  const routeA = () =>
    request(app.getHttpServer())
      .get('/public/orders/lookup')
      .set('X-Forwarded-For', VISITOR_A);
  const routeB = () =>
    request(app.getHttpServer())
      .get('/health')
      .set('X-Forwarded-For', VISITOR_B);
  const remaining = (res: { headers: Record<string, string> }) =>
    Number(res.headers['x-ratelimit-remaining']);

  it("route B's count keeps decaying for visitor B after visitor A's block on route A resets", async () => {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    });
    try {
      // t=0: A exhausts route A (limit 60) and is blocked for 60 s.
      for (let i = 0; i < 60; i++) {
        const res = await routeA();
        expect(res.status).not.toBe(429);
      }
      expect((await routeA()).status).toBe(429);

      // t=30 s: while A is blocked, B uses route B three times.
      jest.advanceTimersByTime(30_000);
      const firstB = await routeB();
      expect(firstB.status).toBe(200);
      const fresh = remaining(firstB);
      expect(fresh).toBe(99);
      await routeB();
      const third = await routeB();
      expect(remaining(third)).toBe(97);

      // t=61 s: A's block has ended and A comes back (the reset path).
      jest.advanceTimersByTime(31_000);
      expect((await routeA()).status).not.toBe(429);

      // t=91 s: B's three hits are older than the 60 s window, so they must
      // have aged out: B's next request is counted as the only one.
      jest.advanceTimersByTime(30_000);
      const afterReset = await routeB();
      expect(afterReset.status).toBe(200);
      expect(remaining(afterReset)).toBe(99);
    } finally {
      jest.useRealTimers();
    }
  });
});
