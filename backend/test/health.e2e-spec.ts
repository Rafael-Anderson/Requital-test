import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

describe('Health checks (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;

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
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health (liveness)', () => {
    it('returns 200 with a public-safe body and no Authorization header', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/ready (readiness)', () => {
    it('returns 200 with a public-safe body when the database is reachable', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('returns 503 with a public-safe body (no stack, no error detail) when the database is unreachable', async () => {
      const spy = jest
        .spyOn(db, 'query')
        .mockRejectedValue(new Error('ECONNREFUSED — this must never reach the client'));
      try {
        const res = await request(app.getHttpServer())
          .get('/health/ready')
          .expect(503);
        expect(res.body).toEqual({ status: 'error' });
      } finally {
        spy.mockRestore();
      }
    });
  });
});
