import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Regression coverage for a real finding: prior to this fix, nothing in the
// app rate-limited /auth/login, /auth/signup, password reset, or any public
// storefront POST endpoint. ThrottlerModule's skipIf (app.module.ts) bypasses
// enforcement whenever NODE_ENV==='test' — Jest sets this automatically, and
// dozens of existing e2e specs legitimately call signup/login many times in
// quick succession, which the 5/min auth limits would otherwise break with
// unrelated 429s. That bypass means the throttling itself is invisible to
// every other e2e spec in this repo — this file exists specifically to prove
// the guard/config wiring actually works, by temporarily overriding NODE_ENV
// for the duration of its own requests only (skipIf is evaluated fresh on
// every request, not cached at app boot — confirmed against the installed
// @nestjs/throttler source before writing this test).
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  const originalNodeEnv = process.env.NODE_ENV;

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

  it('rejects the 6th /auth/login attempt from the same IP within a minute with 429, and a 7th stays throttled', async () => {
    process.env.NODE_ENV = 'e2e-throttle-check';
    try {
      const attempt = () =>
        request(app.getHttpServer()).post('/auth/login').send({
          email: 'rate-limit-probe@test.com',
          password: 'definitely-wrong',
        });

      for (let i = 0; i < 5; i++) {
        const res = await attempt();
        // Credentials are wrong either way — the point is these 5 are not
        // throttled (401, the real "bad credentials" response), only the
        // 6th and 7th should be.
        expect(res.status).toBe(401);
      }
      const sixth = await attempt();
      expect(sixth.status).toBe(429);
      const seventh = await attempt();
      expect(seventh.status).toBe(429);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('does not throttle at all when NODE_ENV is test (the normal state for every other e2e spec in this repo)', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    const attempt = () =>
      request(app.getHttpServer()).post('/auth/login').send({
        email: 'rate-limit-skip-probe@test.com',
        password: 'still-wrong',
      });

    for (let i = 0; i < 8; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }
  });
});
