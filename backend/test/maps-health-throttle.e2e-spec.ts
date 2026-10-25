import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

jest.setTimeout(60000);

// The beacon is unauthenticated, so it is capped per IP (20 a minute).
// THROTTLE_IN_TESTS=1 turns the limiter back on for this instance only.
describe('Maps beacon and geocode throttle (e2e)', () => {
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

  it('allows 20 beacons a minute and rejects the 21st', async () => {
    const post = () =>
      request(app.getHttpServer())
        .post('/public/no-such-shop-throttle/maps-error')
        .send({ code: 'InvalidKeyMapError', host: 'x.requital.io' });
    for (let i = 0; i < 20; i++) await post().expect(404);
    await post().expect(429);
  });

  it('caps the public geocode proxy at 20 a minute (Nominatim policy)', async () => {
    const get = () =>
      request(app.getHttpServer()).get('/public/no-such-shop-throttle/geocode');
    // An empty query answers 400 without any outbound call.
    for (let i = 0; i < 20; i++) await get().expect(400);
    await get().expect(429);
  });
});
