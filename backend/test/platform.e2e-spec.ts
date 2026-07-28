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
interface IdRow {
  id: number;
}
interface ProductBody {
  id: number;
  description: string | null;
  shortSummary: string | null;
  longSummary: string | null;
}
interface SitemapShopRow {
  slug: string;
  updatedAt: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

// >191 chars — the exact length that used to overflow the old VARCHAR(191)
// description/shortSummary/longSummary columns (P2000 "value too long").
const LONG_TEXT =
  'A'.repeat(220) +
  ' — this text is deliberately longer than the old 191-character VARCHAR limit those three product columns used to have, to prove the TEXT widen actually took effect and this round-trips instead of erroring.';

describe('Platform (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Platform Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    return { adminToken: body<AuthResponse>(signup).accessToken, slug: `${slugPrefix}-${runId}` };
  }

  describe('product.description / shortSummary / longSummary column width', () => {
    it('a description well over the old 191-char VARCHAR limit saves and round-trips correctly', async () => {
      expect(LONG_TEXT.length).toBeGreaterThan(191);

      const shop = await setupShop('longtext');
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ name: 'Flowers' })
        .expect(201);
      const categoryId = body<IdRow>(category).id;

      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Long Text Product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `LONGTEXT-${runId}`,
          categoryIds: [categoryId],
          description: LONG_TEXT,
          shortSummary: LONG_TEXT,
          longSummary: LONG_TEXT,
        })
        .expect(201);
      const productId = body<IdRow>(created).id;

      const fetched = await request(app.getHttpServer())
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const product = body<ProductBody>(fetched);
      expect(product.description).toBe(LONG_TEXT);
      expect(product.shortSummary).toBe(LONG_TEXT);
      expect(product.longSummary).toBe(LONG_TEXT);
    });
  });

  describe('GET /public/shops/sitemap', () => {
    // Publishing now requires meeting the readiness bar (an outlet with
    // delivery or pickup enabled, and at least one product) — this suite is
    // about sitemap listing behavior, not readiness itself, so this helper
    // just does the minimum to make that bar met before publishing.
    async function publish(adminToken: string, slugPrefix: string) {
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const outletId = body<IdRow[]>(outlets)[0].id;
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          active: true,
          emirate: 'Dubai',
          deliveryEnabled: true,
          latitude: 25.2048,
          longitude: 55.2708,
          deliveryRadiusKm: 5,
        })
        .expect(200);
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Flowers' })
        .expect(201);
      const categoryId = body<IdRow>(category).id;
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Rose',
          price: 50,
          thumbnail: 'https://example.com/rose.jpg',
          sku: `SITEMAP-${slugPrefix}-${runId}`,
          categoryIds: [categoryId],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
    }

    it('lists a published shop by its slug, with an updatedAt timestamp', async () => {
      const shop = await setupShop('sitemap-list');
      await publish(shop.adminToken, 'sitemap-list');

      const res = await request(app.getHttpServer()).get('/public/shops/sitemap').expect(200);
      const shops = body<SitemapShopRow[]>(res);
      const match = shops.find((s) => s.slug === shop.slug);
      expect(match).toBeDefined();
      expect(match!.updatedAt).toBeTruthy();
    });

    it('exposes only slug and updatedAt — no id, email, or other tenant data', async () => {
      const shop = await setupShop('sitemap-shape');
      await publish(shop.adminToken, 'sitemap-shape');
      const res = await request(app.getHttpServer()).get('/public/shops/sitemap').expect(200);
      const shops = body<Record<string, unknown>[]>(res);
      const match = shops.find((s) => s.slug === shop.slug)!;
      expect(Object.keys(match).sort()).toEqual(['slug', 'updatedAt']);
    });

    it('is unauthenticated — no bearer token required', async () => {
      await request(app.getHttpServer()).get('/public/shops/sitemap').expect(200);
    });

    // shop.published (see migration 20260726100000_shop_published) is now
    // the real gate — this used to document the opposite (every signed-up
    // shop appeared here, including ones never configured beyond signup).
    it('a freshly-signed-up shop is excluded until explicitly published', async () => {
      const shop = await setupShop('sitemap-unconfigured');
      const res = await request(app.getHttpServer()).get('/public/shops/sitemap').expect(200);
      const shops = body<SitemapShopRow[]>(res);
      expect(shops.some((s) => s.slug === shop.slug)).toBe(false);
    });
  });
});
