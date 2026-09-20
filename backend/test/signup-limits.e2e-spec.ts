import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AuthController } from '../src/auth/auth.controller';

function body<T>(res: Response): T {
  return res.body as T;
}

// OPS-10. Throttling is skipped under Jest by default (app.module.ts's
// skipIf), because dozens of specs legitimately hammer /auth/signup and
// /auth/login from one in-process client. THROTTLE_IN_TESTS=1 turns it back
// on for this file only - the seam can only ever ENABLE throttling, never
// disable it in production - so the limits are observed rejecting requests
// rather than assumed from a config literal.
//
// The env var is set before the module is compiled; skipIf reads it per
// request, so this app instance throttles and every other spec's does not.
describe('Signup velocity limits (e2e)', () => {
  let app: INestApplication<App>;
  const runId = Date.now();
  const previous = process.env.THROTTLE_IN_TESTS;

  beforeAll(async () => {
    process.env.THROTTLE_IN_TESTS = '1';
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
    if (previous === undefined) delete process.env.THROTTLE_IN_TESTS;
    else process.env.THROTTLE_IN_TESTS = previous;
  });

  function signupPayload(n: number) {
    const slug = `e2e-limit-${runId}-${n}`;
    return {
      name: 'Velocity Test Admin',
      email: `${slug}@test.com`,
      password: 'password123',
      shopName: `${slug} Shop`,
      subdomain: slug,
    };
  }

  // FIRST, deliberately: the burst below leaves this IP throttled, and a
  // 429 here would make the assertion vacuous. Ordering is the whole
  // guarantee that this test is testing the validator and not the limiter.
  it('rejects a disposable email address with a plain validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        ...signupPayload(99),
        email: `throwaway-${runId}@mailinator.com`,
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(body<unknown>(res))).toMatch(
      /permanent email address/i,
    );
  });

  it('rejects a rapid-fire sequence of signups instead of creating a shop for each', async () => {
    const statuses: number[] = [];
    // The per-minute window is 5. Ten attempts back to back must not produce
    // ten shops.
    for (let n = 0; n < 10; n++) {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send(signupPayload(n));
      statuses.push(res.status);
    }

    const created = statuses.filter((s) => s === 201).length;
    const throttled = statuses.filter((s) => s === 429).length;

    expect(throttled).toBeGreaterThan(0);
    expect(created).toBeLessThanOrEqual(5);
    expect(created + throttled).toBe(10);
    // Once throttled, it stays throttled for the rest of the burst rather
    // than letting every other request through.
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  // The hourly window cannot be observed firing without either 20 successful
  // signups or an hour of waiting, so what is asserted here is that it is
  // actually WIRED to this route - the failure mode worth guarding is someone
  // dropping it from the decorator, not the throttler library miscounting.
  it('declares both a per-minute and a per-hour window on signup', () => {
    // @nestjs/throttler writes one metadata key per named throttler; the
    // exact key format is its own business, so this asserts on the key
    // names rather than hardcoding the prefix.
    const handler = Object.getOwnPropertyDescriptor(
      AuthController.prototype,
      'signup',
    )?.value as object;
    const keys = Reflect.getMetadataKeys(handler) as string[];
    const throttlerKeys = keys.filter((k) => k.startsWith('THROTTLER:'));
    expect(throttlerKeys.join(' ')).toContain('default');
    expect(throttlerKeys.join(' ')).toContain('signupHourly');
  });
});
