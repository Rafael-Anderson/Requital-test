import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';

interface AuthResponse {
  accessToken: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Newsletter subscribe (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

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

  async function setupShop(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Newsletter Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    void body<AuthResponse>(signup);
    return { slug };
  }

  it('subscribes an email and rejects a duplicate with 409', async () => {
    const { slug } = await setupShop('e2e-newsletter');
    const email = `shopper-${runId}@example.com`;

    const first = await request(app.getHttpServer())
      .post(`/public/${slug}/newsletter-subscribe`)
      .send({ email })
      .expect(201);
    expect(body<{ subscribed: boolean }>(first).subscribed).toBe(true);

    await request(app.getHttpServer())
      .post(`/public/${slug}/newsletter-subscribe`)
      .send({ email })
      .expect(409);

    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM newslettersubscriber WHERE email = ?`,
      [email],
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects a malformed email rather than 500ing', async () => {
    const { slug } = await setupShop('e2e-newsletter-bad');
    await request(app.getHttpServer())
      .post(`/public/${slug}/newsletter-subscribe`)
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('the same email can subscribe independently at two different shops', async () => {
    const shopA = await setupShop('e2e-newsletter-a');
    const shopB = await setupShop('e2e-newsletter-b');
    const email = `cross-shop-${runId}@example.com`;

    await request(app.getHttpServer())
      .post(`/public/${shopA.slug}/newsletter-subscribe`)
      .send({ email })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/public/${shopB.slug}/newsletter-subscribe`)
      .send({ email })
      .expect(201);
  });
});
