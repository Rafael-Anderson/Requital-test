import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthResponse {
  accessToken: string;
}
interface ShopBody {
  productEditorMode: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Product editor mode (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function signupShop(
    slugPrefix: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Editor Mode Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
        ...extra,
      })
      .expect(201);
    return body<AuthResponse>(res).accessToken;
  }

  it('defaults to simple when not provided on signup', async () => {
    const token = await signupShop('editor-mode-default');
    const res = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(body<ShopBody>(res).productEditorMode).toBe('simple');
  });

  it('accepts an explicit mode on signup', async () => {
    const token = await signupShop('editor-mode-signup-advanced', {
      productEditorMode: 'advanced',
    });
    const res = await request(app.getHttpServer())
      .get('/shop')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(body<ShopBody>(res).productEditorMode).toBe('advanced');
  });

  it('PATCH /shop updates the mode', async () => {
    const token = await signupShop('editor-mode-patch');
    const res = await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${token}`)
      .send({ productEditorMode: 'advanced' })
      .expect(200);
    expect(body<ShopBody>(res).productEditorMode).toBe('advanced');
  });

  it('rejects an invalid mode', async () => {
    const token = await signupShop('editor-mode-invalid');
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${token}`)
      .send({ productEditorMode: 'expert' })
      .expect(400);
  });
});
