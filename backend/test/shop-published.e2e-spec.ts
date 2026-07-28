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
  user: { shopId: number };
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface ShopBody {
  published: boolean;
}
interface SitemapRow {
  slug: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Shop publish state (e2e)', () => {
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
        name: 'Publish Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    const res = body<AuthResponse>(signup);
    return { adminToken: res.accessToken, slug: `${slugPrefix}-${runId}`, shopId: res.user.shopId };
  }

  async function setupOrderableShop(slugPrefix: string) {
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
        pickupEnabled: true,
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
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({
        name: 'Rose',
        price: 50,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `PUB-${slugPrefix}-${runId}`,
        categoryIds: [categoryId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;
    return { ...shop, outletId, productId };
  }

  describe('new signups default to unpublished', () => {
    it('a fresh shop reads published: false', async () => {
      const shop = await setupShop('pub-default');
      const res = await request(app.getHttpServer()).get(`/public/${shop.slug}`).expect(200);
      expect(body<ShopBody>(res).published).toBe(false);
    });
  });

  describe('backfill rule: outlet configured (delivery or pickup enabled) AND has a product', () => {
    it('matches a fully set-up shop but not a bare signup — same condition the migration backfill used', async () => {
      const readyShop = await setupOrderableShop('pub-backfill-ready');
      const emptyShop = await setupShop('pub-backfill-empty');

      // Re-runs the exact predicate migration 20260726100000_shop_published
      // used to backfill existing rows — a permanent regression check on the
      // rule itself, not just a one-time migration run.
      const [readyRow] = await prisma.$queryRaw<{ wouldPublish: number }[]>`
        SELECT
          (EXISTS (
            SELECT 1 FROM outlet WHERE outlet.shopId = ${readyShop.shopId}
              AND (outlet.deliveryEnabled = true OR outlet.pickupEnabled = true)
          ) AND EXISTS (
            SELECT 1 FROM product WHERE product.shopId = ${readyShop.shopId}
          )) AS wouldPublish
      `;
      const [emptyRow] = await prisma.$queryRaw<{ wouldPublish: number }[]>`
        SELECT
          (EXISTS (
            SELECT 1 FROM outlet WHERE outlet.shopId = ${emptyShop.shopId}
              AND (outlet.deliveryEnabled = true OR outlet.pickupEnabled = true)
          ) AND EXISTS (
            SELECT 1 FROM product WHERE product.shopId = ${emptyShop.shopId}
          )) AS wouldPublish
      `;
      expect(Number(readyRow.wouldPublish)).toBe(1);
      expect(Number(emptyRow.wouldPublish)).toBe(0);
    });
  });

  describe('storefront gating for an unpublished shop', () => {
    it('every content-serving endpoint 404s, but getShop itself still resolves (for a "coming soon" page)', async () => {
      const shop = await setupOrderableShop('pub-gated');

      await request(app.getHttpServer()).get(`/public/${shop.slug}`).expect(200);
      await request(app.getHttpServer()).get(`/public/${shop.slug}/categories`).expect(404);
      await request(app.getHttpServer()).get(`/public/${shop.slug}/products`).expect(404);
      await request(app.getHttpServer()).get(`/public/${shop.slug}/outlets`).expect(404);
      await request(app.getHttpServer())
        .get(`/public/${shop.slug}/outlets/${shop.outletId}/delivery-zones`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/${shop.slug}/products/slug/rose`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Test Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(404);
    });

    it('publishing the shop immediately unblocks every one of those endpoints', async () => {
      const shop = await setupOrderableShop('pub-unblocked');

      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(200);

      await request(app.getHttpServer()).get(`/public/${shop.slug}/categories`).expect(200);
      await request(app.getHttpServer()).get(`/public/${shop.slug}/products`).expect(200);
      await request(app.getHttpServer()).get(`/public/${shop.slug}/outlets`).expect(200);
      const orderRes = await request(app.getHttpServer())
        .post(`/public/${shop.slug}/orders`)
        .send({
          outletId: shop.outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Test Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Test St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: shop.productId, quantity: 1 }],
        })
        .expect(201);
      expect(body<{ order: { id: number } }>(orderRes).order.id).toBeTruthy();
    });
  });

  describe('GET /public/shops/sitemap only includes published shops', () => {
    it('excludes an unpublished shop, includes it once published', async () => {
      // Publishing now requires meeting the readiness bar (see the
      // publish-readiness describe block below) — setupOrderableShop, not
      // the bare setupShop, since this test is about sitemap filtering, not
      // readiness itself.
      const shop = await setupOrderableShop('pub-sitemap');

      let sitemap = await request(app.getHttpServer()).get('/public/shops/sitemap').expect(200);
      expect(body<SitemapRow[]>(sitemap).some((s) => s.slug === shop.slug)).toBe(false);

      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(200);

      sitemap = await request(app.getHttpServer()).get('/public/shops/sitemap').expect(200);
      expect(body<SitemapRow[]>(sitemap).some((s) => s.slug === shop.slug)).toBe(true);
    });
  });

  describe('publish readiness gate', () => {
    it('rejects publishing when the shop has no products', async () => {
      const shop = await setupShop('pub-ready-no-product');
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

      const res = await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(400);
      expect(body<{ message: string }>(res).message).toContain('Add at least one product');
    });

    it('rejects publishing when no outlet has delivery or pickup enabled', async () => {
      const shop = await setupShop('pub-ready-no-outlet');
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
          sku: `PUB-READY-${runId}`,
          categoryIds: [categoryId],
        })
        .expect(201);
      // Outlet exists (auto-created at signup) but neither deliveryEnabled
      // nor pickupEnabled has ever been turned on — the actual signal, not
      // bare outlet-row existence (see getPublishReadiness).

      const res = await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(400);
      expect(body<{ message: string }>(res).message).toContain('Enable delivery or pickup');
    });

    it('succeeds once both conditions are met', async () => {
      const shop = await setupOrderableShop('pub-ready-ok');
      const res = await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(200);
      expect(body<ShopBody>(res).published).toBe(true);
    });

    it('GET /shop/publish-readiness reflects the same logic before the merchant even tries to publish', async () => {
      const shop = await setupShop('pub-ready-endpoint');
      let res = await request(app.getHttpServer())
        .get('/shop/publish-readiness')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<{ ready: boolean; missing: string[] }>(res).ready).toBe(false);

      const ready = await setupOrderableShop('pub-ready-endpoint-ok');
      res = await request(app.getHttpServer())
        .get('/shop/publish-readiness')
        .set('Authorization', `Bearer ${ready.adminToken}`)
        .expect(200);
      expect(body<{ ready: boolean; missing: string[] }>(res).ready).toBe(true);
      expect(body<{ ready: boolean; missing: string[] }>(res).missing).toEqual([]);
    });

    it('an already-published shop is not retroactively unpublished by an unrelated update, even if it would no longer meet the bar', async () => {
      const shop = await setupOrderableShop('pub-ready-grandfathered');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true })
        .expect(200);

      // An unrelated field update, still carrying published: true (as the
      // admin UI's PublishCard does on every save) — must not re-validate
      // readiness now that the shop is already live, even though nothing
      // here actually changed the shop's product/outlet configuration.
      const res = await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ published: true, description: 'Updated description' })
        .expect(200);
      expect(body<ShopBody>(res).published).toBe(true);
    });
  });
});
