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

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Footer/announcement/banners (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function signup(slugPrefix: string) {
    const slug = `${slugPrefix}-${runId}`;
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Footer Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    return { adminToken: body<AuthResponse>(res).accessToken, slug };
  }

  describe('Policy pages', () => {
    it('admin CRUD: starts as all 5 types with null content, upsert fills one in', async () => {
      const { adminToken } = await signup('policy-crud');

      const initial = await request(app.getHttpServer())
        .get('/shop/policy-pages')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const rows = body<{ type: string; content: string | null }[]>(initial);
      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.content === null)).toBe(true);

      await request(app.getHttpServer())
        .patch('/shop/policy-pages/TERMS')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: '<p>Our terms.</p>' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/shop/policy-pages')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const afterRows = body<{ type: string; content: string | null }[]>(after);
      expect(afterRows.find((r) => r.type === 'TERMS')?.content).toBe('<p>Our terms.</p>');
      expect(afterRows.find((r) => r.type === 'PRIVACY')?.content).toBeNull();
    });

    it('rejects an unknown policy type', async () => {
      const { adminToken } = await signup('policy-badtype');
      await request(app.getHttpServer())
        .patch('/shop/policy-pages/NOT_A_TYPE')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'x' })
        .expect(400);
    });

    it('public GET 404s for a type with no content, 200s once written', async () => {
      const { adminToken, slug } = await signup('policy-public');

      await request(app.getHttpServer()).get(`/public/${slug}/policy-pages/PRIVACY`).expect(404);

      await request(app.getHttpServer())
        .patch('/shop/policy-pages/PRIVACY')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: '<p>We respect your privacy.</p>' })
        .expect(200);

      const res = await request(app.getHttpServer()).get(`/public/${slug}/policy-pages/PRIVACY`).expect(200);
      expect(body<{ content: string }>(res).content).toBe('<p>We respect your privacy.</p>');
    });

    it('tenant isolation: shop A writing a policy page never appears under shop B, even for the same type', async () => {
      const shopA = await signup('policy-tenant-a');
      const shopB = await signup('policy-tenant-b');

      await request(app.getHttpServer())
        .patch('/shop/policy-pages/REFUND')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ content: "<p>Shop A's refund policy.</p>" })
        .expect(200);

      // Shop B never wrote a REFUND policy — must 404, not see shop A's content.
      await request(app.getHttpServer()).get(`/public/${shopB.slug}/policy-pages/REFUND`).expect(404);

      // Shop A's admin list must not somehow be affected by shop B's (empty) state either.
      const listA = await request(app.getHttpServer())
        .get('/shop/policy-pages')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<{ type: string; content: string | null }[]>(listA).find((r) => r.type === 'REFUND')?.content).toBe(
        "<p>Shop A's refund policy.</p>",
      );

      const listB = await request(app.getHttpServer())
        .get('/shop/policy-pages')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<{ type: string; content: string | null }[]>(listB).find((r) => r.type === 'REFUND')?.content).toBeNull();
    });
  });

  describe('Homepage banners', () => {
    it('add/reorder/remove via the theme images array, full replace each save', async () => {
      const { adminToken } = await signup('banners-crud');

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ images: [{ url: '/uploads/theme/a.jpg' }, { url: '/uploads/theme/b.jpg' }] })
        .expect(200);

      const afterAdd = await request(app.getHttpServer()).get('/theme').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const imagesAfterAdd = body<{ images: { url: string; order: number }[] }>(afterAdd).images;
      expect(imagesAfterAdd.map((i) => i.url)).toEqual(['/uploads/theme/a.jpg', '/uploads/theme/b.jpg']);
      expect(imagesAfterAdd.map((i) => i.order)).toEqual([0, 1]);

      // Reorder (swap) — full replace, not a patch/move operation.
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ images: [{ url: '/uploads/theme/b.jpg' }, { url: '/uploads/theme/a.jpg' }] })
        .expect(200);

      const afterReorder = await request(app.getHttpServer()).get('/theme').set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(body<{ images: { url: string }[] }>(afterReorder).images.map((i) => i.url)).toEqual([
        '/uploads/theme/b.jpg',
        '/uploads/theme/a.jpg',
      ]);

      // Remove one.
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ images: [{ url: '/uploads/theme/b.jpg' }] })
        .expect(200);

      const afterRemove = await request(app.getHttpServer()).get('/theme').set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(body<{ images: { url: string }[] }>(afterRemove).images).toHaveLength(1);
    });

    it('a slide can carry its own optional link', async () => {
      const { adminToken } = await signup('banners-link');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ images: [{ url: '/uploads/theme/promo.jpg', linkUrl: '/collections/sale' }] })
        .expect(200);

      const res = await request(app.getHttpServer()).get('/theme').set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(body<{ images: { linkUrl: string | null }[] }>(res).images[0].linkUrl).toBe('/collections/sale');
    });

    it('tenant isolation: shop A saving banners never appears in shop B', async () => {
      const shopA = await signup('banners-tenant-a');
      const shopB = await signup('banners-tenant-b');

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ images: [{ url: '/uploads/theme/shopA-only.jpg' }] })
        .expect(200);

      const resB = await request(app.getHttpServer()).get('/theme').set('Authorization', `Bearer ${shopB.adminToken}`).expect(200);
      expect(body<{ images: unknown[] }>(resB).images).toEqual([]);

      // And the public-facing shape agrees.
      const publicB = await request(app.getHttpServer()).get(`/public/${shopB.slug}`).expect(200);
      expect(body<{ banners: unknown[] }>(publicB).banners).toEqual([]);
    });
  });

  describe('Public shop response', () => {
    it('exposes footerDescription, announcement bar toggles, banners in order, and only written policy types', async () => {
      const { adminToken, slug } = await signup('public-shop-shape');

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          footerDescription: 'Same-day flower delivery across Dubai.',
          announcementBarEnabled: true,
          announcementBarScrolling: true,
          notificationText: ['Free delivery over 100 AED'],
          images: [{ url: '/uploads/theme/hero1.jpg' }, { url: '/uploads/theme/hero2.jpg' }],
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/shop/policy-pages/SHIPPING')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: '<p>We ship across the UAE.</p>' })
        .expect(200);

      const res = await request(app.getHttpServer()).get(`/public/${slug}`).expect(200);
      const shop = body<{
        footerDescription: string | null;
        announcementBarEnabled: boolean;
        announcementBarScrolling: boolean;
        banners: { url: string; order: number }[];
        policyPageTypes: string[];
        email: string | null;
        legalName: string | null;
        trademarkFormat: string;
      }>(res);

      expect(shop.footerDescription).toBe('Same-day flower delivery across Dubai.');
      expect(shop.announcementBarEnabled).toBe(true);
      expect(shop.announcementBarScrolling).toBe(true);
      expect(shop.banners.map((b) => b.url)).toEqual(['/uploads/theme/hero1.jpg', '/uploads/theme/hero2.jpg']);
      expect(shop.policyPageTypes).toEqual(['SHIPPING']);
      expect(shop.trademarkFormat).toBe('brand');
    });
  });
});
