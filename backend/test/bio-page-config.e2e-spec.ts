import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface OutletRow {
  id: number;
}
interface IdRow {
  id: number;
}
interface BioPageConfigRow {
  logoUrl: string | null;
  backgroundUrl: string | null;
  description: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Bio Link page config (e2e)', () => {
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

  async function setupShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Bio Page Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    await verifySignupEmail(app.getHttpServer(), body<AuthResponse>(signup).devVerificationLink);
    return {
      adminToken: body<AuthResponse>(signup).accessToken,
      slug: `${slugPrefix}-${runId}`,
    };
  }

  async function setupPublishedShop(slugPrefix: string) {
    const shop = await setupShop(slugPrefix);
    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
    await request(app.getHttpServer())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${shop.adminToken}`)
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
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Rose',
        price: 50,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `BIOPAGE-${slugPrefix}-${runId}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ published: true })
      .expect(200);
    return shop;
  }

  describe('GET/PATCH /shop/bio-links/page-config', () => {
    it('returns an all-null shape before anything is saved', async () => {
      const shop = await setupShop('biopage-default');
      const res = await request(app.getHttpServer())
        .get('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const config = body<BioPageConfigRow>(res);
      expect(config.logoUrl).toBeNull();
      expect(config.backgroundUrl).toBeNull();
      expect(config.description).toBeNull();
      expect(config.metaTitle).toBeNull();
      expect(config.metaDescription).toBeNull();
    });

    it('persists a partial save and a subsequent partial save does not clobber earlier fields', async () => {
      const shop = await setupShop('biopage-persist');
      await request(app.getHttpServer())
        .patch('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          logoUrl: '/uploads/bio-links/logo.png',
          description: 'Welcome to our shop',
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ metaTitle: 'My Bio Page' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const config = body<BioPageConfigRow>(res);
      expect(config.logoUrl).toBe('/uploads/bio-links/logo.png');
      expect(config.description).toBe('Welcome to our shop');
      expect(config.metaTitle).toBe('My Bio Page');
    });
  });

  describe('POST /shop/bio-links/upload', () => {
    it('uploads an image and returns a URL under /uploads/bio-links/', async () => {
      const shop = await setupShop('biopage-upload');
      const res = await request(app.getHttpServer())
        .post('/shop/bio-links/upload')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: 'logo.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(body<{ url: string }>(res).url).toMatch(/^\/uploads\/bio-links\//);
    });
  });

  describe('tenant isolation', () => {
    it("shop A cannot read or overwrite shop B's page config", async () => {
      const shopA = await setupShop('biopage-tenant-a');
      const shopB = await setupShop('biopage-tenant-b');
      await request(app.getHttpServer())
        .patch('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ description: "B's real description" })
        .expect(200);

      // A's GET is scoped to A's own (empty) config — never B's.
      const resA = await request(app.getHttpServer())
        .get('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<BioPageConfigRow>(resA).description).toBeNull();

      // A's PATCH can only ever create/update A's own row (ctx.shopId, never
      // a shopId from the body — there's no shopId field to send at all).
      await request(app.getHttpServer())
        .patch('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ description: "A's attempt" })
        .expect(200);

      const resB = await request(app.getHttpServer())
        .get('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<BioPageConfigRow>(resB).description).toBe(
        "B's real description",
      );
    });
  });

  describe('GET /public/:shopSlug/bio-page-config', () => {
    it('404s for an unpublished shop', async () => {
      const shop = await setupShop('biopage-unpublished');
      await request(app.getHttpServer())
        .get(`/public/${shop.slug}/bio-page-config`)
        .expect(404);
    });

    it('returns the raw saved overrides (unresolved — fallback happens storefront-side) for a published shop', async () => {
      const shop = await setupPublishedShop('biopage-public');
      await request(app.getHttpServer())
        .patch('/shop/bio-links/page-config')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          logoUrl: '/uploads/bio-links/mylogo.png',
          backgroundUrl: '/uploads/bio-links/bg.png',
          description: 'A great shop',
          metaTitle: 'Custom Bio Title',
          metaDescription: 'Custom bio description',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/bio-page-config`)
        .expect(200);
      const config = body<BioPageConfigRow>(res);
      expect(config.logoUrl).toBe('/uploads/bio-links/mylogo.png');
      expect(config.backgroundUrl).toBe('/uploads/bio-links/bg.png');
      expect(config.description).toBe('A great shop');
      expect(config.metaTitle).toBe('Custom Bio Title');
      expect(config.metaDescription).toBe('Custom bio description');
    });

    it('returns an all-null shape for a published shop that never customized the bio page', async () => {
      const shop = await setupPublishedShop('biopage-public-empty');
      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/bio-page-config`)
        .expect(200);
      const config = body<BioPageConfigRow>(res);
      expect(config.logoUrl).toBeNull();
      expect(config.backgroundUrl).toBeNull();
      expect(config.description).toBeNull();
      expect(config.metaTitle).toBeNull();
      expect(config.metaDescription).toBeNull();
    });
  });
});
