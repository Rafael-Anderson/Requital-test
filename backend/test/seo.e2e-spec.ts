import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface SeoBody {
  shopId: number;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: string | null;
  keywords: string | null;
}
interface PublicShopBody {
  name: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: string | null;
  keywords: string | null;
}
interface PublicProductBody {
  id: number;
  slug: string;
  name: string;
  metaTitle: string;
  metaDescription: string | null;
}
interface ProductBody {
  id: number;
  slug: string;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

function messageContains(res: Response, substring: string): boolean {
  const { message } = body<ErrorBody>(res);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((m) => m.includes(substring));
}

describe('SEO (e2e)', () => {
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
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'SEO Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    // Publishing requires meeting the readiness bar (an outlet with
    // delivery or pickup enabled, and at least one product — see
    // ShopService.getPublishReadiness) — a throwaway outlet config + product
    // just to clear that bar, independent of whatever products each
    // individual test goes on to create via setupProductFixture.
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
    // A distinctly-named collection, not 'Flowers' — each test's own
    // setupProductFixture(adminToken) call creates a 'Flowers' collection too,
    // and collection names are unique per shop.
    const readinessCollection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Readiness Placeholder Collection' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Readiness Placeholder',
        price: 10,
        thumbnail: 'https://example.com/placeholder.jpg',
        sku: `SEO-READY-${slugPrefix}-${runId}`,
        collectionIds: [body<IdRow>(readinessCollection).id],
      })
      .expect(201);

    // Every content-serving /public/:slug/* endpoint now 404s for an
    // unpublished shop (see PublicService.assertPublished) — this suite
    // exercises several of those, so every shop it creates needs to be
    // published up front, same as any other real merchant would do before
    // expecting their catalog to be reachable.
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
    return { adminToken, slug: `${slugPrefix}-${runId}` };
  }

  async function setupProductFixture(adminToken: string) {
    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    return body<IdRow>(collection).id;
  }

  describe('GET /seo defaults for an unconfigured shop', () => {
    it('returns an all-null shape rather than 404', async () => {
      const shop = await setupShop('seo-default');
      const res = await request(app.getHttpServer())
        .get('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const seo = body<SeoBody>(res);
      expect(seo.metaTitle).toBeNull();
      expect(seo.metaDescription).toBeNull();
      expect(seo.ogImage).toBeNull();
      expect(seo.keywords).toBeNull();
    });

    it('the public shop payload has null SEO fields, not a broken/missing shape', async () => {
      const shop = await setupShop('seo-default-public');
      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const publicShop = body<PublicShopBody>(res);
      expect(publicShop.metaTitle).toBeNull();
      expect(publicShop.metaDescription).toBeNull();
      expect(publicShop.ogImage).toBeNull();
    });
  });

  describe('PATCH /seo — save/load, upsert', () => {
    it('saves and reads back every field; a second PATCH updates the same row', async () => {
      const shop = await setupShop('seo-crud');
      await request(app.getHttpServer())
        .patch('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          metaTitle: 'Best Flowers in Dubai',
          metaDescription: 'Same-day flower delivery.',
          keywords: 'flowers, dubai',
        })
        .expect(200);

      const afterFirst = await request(app.getHttpServer())
        .get('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<SeoBody>(afterFirst)).toMatchObject({
        metaTitle: 'Best Flowers in Dubai',
        metaDescription: 'Same-day flower delivery.',
        keywords: 'flowers, dubai',
      });

      await request(app.getHttpServer())
        .patch('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ metaTitle: 'Updated Title' })
        .expect(200);
      const afterSecond = await request(app.getHttpServer())
        .get('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<SeoBody>(afterSecond)).toMatchObject({
        metaTitle: 'Updated Title',
        metaDescription: 'Same-day flower delivery.',
      });

      const rowCountRows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM shopseosettings s JOIN shop ON shop.id = s.shopId WHERE shop.subdomain = ?`,
        [shop.slug],
      );
      expect(Number(rowCountRows[0].c)).toBe(1);
    });

    it('ogImage falls back to Theme banner, then Theme logo, when unset', async () => {
      const shop = await setupShop('seo-og-fallback');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          bannerUrl: '/uploads/theme/banner.jpg',
          logoUrl: '/uploads/theme/logo.jpg',
        })
        .expect(200);

      const publicNoSeoImage = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(body<PublicShopBody>(publicNoSeoImage).ogImage).toBe(
        '/uploads/theme/banner.jpg',
      );

      await request(app.getHttpServer())
        .patch('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ ogImage: '/uploads/seo/og.jpg' })
        .expect(200);
      const publicWithSeoImage = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      // An explicit SEO ogImage wins over the Theme banner fallback.
      expect(body<PublicShopBody>(publicWithSeoImage).ogImage).toBe(
        '/uploads/seo/og.jpg',
      );
    });
  });

  describe('multi-tenant isolation', () => {
    it("shop A's SEO settings never appear on shop B's admin GET or public payload", async () => {
      const shopA = await setupShop('seo-iso-a');
      const shopB = await setupShop('seo-iso-b');

      await request(app.getHttpServer())
        .patch('/seo')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ metaTitle: 'Shop A only', keywords: 'shop-a-secret' })
        .expect(200);

      const seoB = await request(app.getHttpServer())
        .get('/seo')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<SeoBody>(seoB).metaTitle).toBeNull();

      const publicB = await request(app.getHttpServer())
        .get(`/public/${shopB.slug}`)
        .expect(200);
      expect(body<PublicShopBody>(publicB).metaTitle).toBeNull();
    });
  });

  describe('permission boundary: SEO is admin-only', () => {
    it('a branch user gets 403 on GET/PATCH; the admin gets 200', async () => {
      const shop = await setupShop('seo-perm');
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const outletId = body<{ id: number }[]>(outlets)[0].id;

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `seo-branch-${runId}@test.com`,
          password: 'password123',
          outletId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `seo-branch-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/seo')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .patch('/seo')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ metaTitle: 'nope' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/seo')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
    });
  });

  describe('product metadata fallback', () => {
    it('a product with no SEO fields set falls back to name + truncated description', async () => {
      const shop = await setupShop('product-seo-fallback');
      const collectionId = await setupProductFixture(shop.adminToken);
      // Long enough to exceed the 160-char meta-description cutoff. (Used to
      // also need to stay under description's old 191-char VARCHAR limit —
      // that column is TEXT now, see platform.e2e-spec.ts's regression test.)
      const longDescription =
        'This product description is long enough to exceed one hundred and sixty characters so the truncation logic actually has something real to cut down for the meta tag here today.';

      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Rose Bouquet',
          price: 100,
          thumbnail: 'https://example.com/rose.jpg',
          sku: `ROSE-FB-${runId}`,
          description: longDescription,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(created).id;

      const pub = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/products/${productId}`)
        .expect(200);
      const product = body<PublicProductBody>(pub);
      expect(product.metaTitle).toBe('Rose Bouquet');
      expect(product.metaDescription).not.toBeNull();
      expect(product.metaDescription!.length).toBeLessThanOrEqual(161); // 160 + ellipsis
      expect(
        longDescription.startsWith(product.metaDescription!.replace('…', '')),
      ).toBe(true);
    });

    it('explicit metaTitle/metaDescription override the fallback', async () => {
      const shop = await setupShop('product-seo-explicit');
      const collectionId = await setupProductFixture(shop.adminToken);

      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Rose Bouquet',
          price: 100,
          thumbnail: 'https://example.com/rose.jpg',
          sku: `ROSE-EX-${runId}`,
          collectionIds: [collectionId],
          metaTitle: 'Buy Fresh Roses Online',
          metaDescription: 'Custom description for SEO.',
        })
        .expect(201);
      const productId = body<IdRow>(created).id;

      const pub = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/products/${productId}`)
        .expect(200);
      const product = body<PublicProductBody>(pub);
      expect(product.metaTitle).toBe('Buy Fresh Roses Online');
      expect(product.metaDescription).toBe('Custom description for SEO.');
    });
  });

  describe('product slug uniqueness', () => {
    it('auto-generates unique slugs for two products with the same name in the same shop', async () => {
      const shop = await setupShop('slug-collision');
      const collectionId = await setupProductFixture(shop.adminToken);

      const first = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Chocolate Cake',
          price: 50,
          thumbnail: 'https://example.com/cake.jpg',
          sku: `CAKE-1-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Chocolate Cake',
          price: 55,
          thumbnail: 'https://example.com/cake2.jpg',
          sku: `CAKE-2-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);

      const firstSlug = body<ProductBody>(first).slug;
      const secondSlug = body<ProductBody>(second).slug;
      expect(firstSlug).toBe('chocolate-cake');
      expect(secondSlug).toBe('chocolate-cake-2');
      expect(firstSlug).not.toBe(secondSlug);

      // Both resolve correctly via the public slug route.
      await request(app.getHttpServer())
        .get(`/public/${shop.slug}/products/slug/${firstSlug}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/public/${shop.slug}/products/slug/${secondSlug}`)
        .expect(200);
    });

    it('the same product name in two different shops is fine — no cross-shop collision', async () => {
      const shopA = await setupShop('slug-cross-a');
      const shopB = await setupShop('slug-cross-b');
      const collectionA = await setupProductFixture(shopA.adminToken);
      const collectionB = await setupProductFixture(shopB.adminToken);

      const productA = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          name: 'Signature Bouquet',
          price: 100,
          thumbnail: 'https://example.com/a.jpg',
          sku: `SIG-A-${runId}`,
          collectionIds: [collectionA],
        })
        .expect(201);
      const productB = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          name: 'Signature Bouquet',
          price: 100,
          thumbnail: 'https://example.com/b.jpg',
          sku: `SIG-B-${runId}`,
          collectionIds: [collectionB],
        })
        .expect(201);

      expect(body<ProductBody>(productA).slug).toBe('signature-bouquet');
      expect(body<ProductBody>(productB).slug).toBe('signature-bouquet');

      // Shop A's product is not reachable under shop B's slug route and vice versa.
      await request(app.getHttpServer())
        .get(`/public/${shopA.slug}/products/slug/signature-bouquet`)
        .expect(200)
        .then((res) =>
          expect(body<PublicProductBody>(res).id).toBe(
            body<ProductBody>(productA).id,
          ),
        );
      await request(app.getHttpServer())
        .get(`/public/${shopB.slug}/products/slug/signature-bouquet`)
        .expect(200)
        .then((res) =>
          expect(body<PublicProductBody>(res).id).toBe(
            body<ProductBody>(productB).id,
          ),
        );
    });

    it('an explicit slug that collides is rejected with a 409, not silently disambiguated', async () => {
      const shop = await setupShop('slug-explicit-conflict');
      const collectionId = await setupProductFixture(shop.adminToken);

      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'First Product',
          price: 10,
          thumbnail: 'https://example.com/1.jpg',
          sku: `EXPL-1-${runId}`,
          collectionIds: [collectionId],
          slug: 'taken-slug',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Second Product',
          price: 10,
          thumbnail: 'https://example.com/2.jpg',
          sku: `EXPL-2-${runId}`,
          collectionIds: [collectionId],
          slug: 'taken-slug',
        })
        .expect(409);
      expect(messageContains(res, 'slug')).toBe(true);
    });

    it('rejects a slug with invalid characters', async () => {
      const shop = await setupShop('slug-invalid');
      const collectionId = await setupProductFixture(shop.adminToken);

      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Bad Slug Product',
          price: 10,
          thumbnail: 'https://example.com/1.jpg',
          sku: `BADSLUG-${runId}`,
          collectionIds: [collectionId],
          slug: 'Not A Valid Slug!',
        })
        .expect(400);
    });

    it('editing other fields does not silently change an already-published slug', async () => {
      const shop = await setupShop('slug-stable');
      const collectionId = await setupProductFixture(shop.adminToken);

      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Stable Slug Product',
          price: 10,
          thumbnail: 'https://example.com/1.jpg',
          sku: `STABLE-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(created).id;
      const originalSlug = body<ProductBody>(created).slug;

      const updated = await request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ name: 'Renamed Product', price: 20 })
        .expect(200);
      expect(body<ProductBody>(updated).slug).toBe(originalSlug);
    });
  });

  describe('id-based product route keeps working (backward compatibility)', () => {
    it('an old id-based link still resolves the product, including its slug', async () => {
      const shop = await setupShop('id-route-compat');
      const collectionId = await setupProductFixture(shop.adminToken);

      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Legacy Link Product',
          price: 10,
          thumbnail: 'https://example.com/1.jpg',
          sku: `LEGACY-${runId}`,
          collectionIds: [collectionId],
        })
        .expect(201);
      const productId = body<IdRow>(created).id;

      const byId = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/products/${productId}`)
        .expect(200);
      expect(body<ProductBody>(byId).slug).toBe('legacy-link-product');
    });
  });
});
