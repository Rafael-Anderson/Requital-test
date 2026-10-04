import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Throttling is skipped under Jest by default; THROTTLE_IN_TESTS=1 turns it
// back on for this file only (same seam as signup-limits.e2e-spec.ts), so the
// withdraw route's limit is observed rejecting requests, not assumed.
describe('Survey withdraw throttle (e2e)', () => {
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

  it('answers 429 once one client exceeds 20 withdraw attempts a minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await request(app.getHttpServer()).post(
        `/public/surveys/withdraw-consent?token=NOPE${i}`,
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
  });
});
