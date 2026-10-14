import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

// The order lookup is a bearer-token reader that the confirmation page polls
// (about 30 requests a minute at worst). THROTTLE_IN_TESTS=1 (see
// signup-limits.e2e-spec.ts) turns the limiter back on for this app instance
// only, so the 60-a-minute cap is observed rejecting rather than assumed.
describe('Order lookup throttle (e2e)', () => {
  let app: INestApplication<App>;
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

  it('allows 60 lookups a minute and rejects the 61st', async () => {
    const get = () =>
      request(app.getHttpServer()).get(
        `/public/orders/lookup?token=${'A'.repeat(32)}`,
      );
    for (let i = 0; i < 60; i++) await get().expect(404);
    await get().expect(429);
  });
});
