import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import type { BiolinkRow as BiolinkDbRow } from '../src/db/types';
import { verifySignupEmail } from './helpers/verify-signup-email';

interface AuthResponse {
  accessToken: string;
  devVerificationLink?: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface BioLinkRow {
  id: number;
  type: string;
  label: string;
  url: string | null;
  productId: number | null;
  productName: string | null;
  collectionId: number | null;
  collectionName: string | null;
  socialPlatform: string | null;
  order: number;
  active: boolean;
  clickCount: number;
}
interface PublicBioLinkRow {
  id: number;
  type: string;
  label: string;
  product?: { name: string; slug: string; thumbnail: string } | null;
  collection?: { name: string; slug: string; image: string | null } | null;
  template?: { title: string; slug: string; image: string | null } | null;
  socialPlatform?: string | null;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Bio Links (e2e)', () => {
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

  async function getBiolink(id: number): Promise<BiolinkDbRow> {
    const rows = await db.query<(BiolinkDbRow & RowDataPacket)[]>(
      `SELECT * FROM biolink WHERE id = ?`,
      [id],
    );
    if (!rows[0]) throw new Error('biolink not found');
    return rows[0];
  }

  async function setupOrderableShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Bio Links Admin',
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
    const slug = `${slugPrefix}-${runId}`;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;
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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rose',
        price: 50,
        thumbnail: 'https://example.com/rose.jpg',
        sku: `BIO-${slugPrefix}-${runId}`,
        collectionIds: [collectionId],
      })
      .expect(201);
    const productId = body<IdRow>(product).id;

    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);

    return { adminToken, slug, outletId, collectionId, productId };
  }

  describe('DTO / service validation', () => {
    it('rejects a link whose target field does not match its type (EXTERNAL_URL with productId set)', async () => {
      const shop = await setupOrderableShop('bio-validate-mismatch');
      const res = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'My Link',
          url: 'https://example.com',
          productId: shop.productId,
        })
        .expect(400);
      expect(body<ErrorBody>(res).message).toContain(
        "type 'EXTERNAL_URL' requires exactly 'url' to be set, and no other target field (url/productId/collectionId/templateId/socialPlatform)",
      );
    });

    it('rejects PRODUCT type with no productId', async () => {
      const shop = await setupOrderableShop('bio-validate-noproduct');
      await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'PRODUCT', label: 'My Product' })
        .expect(400);
    });

    it('rejects a non-SOCIAL_ICON link with no label', async () => {
      const shop = await setupOrderableShop('bio-validate-nolabel');
      await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'EXTERNAL_URL', url: 'https://example.com' })
        .expect(400);
    });

    it('allows SOCIAL_ICON with no label, falling back to the platform display name', async () => {
      const shop = await setupOrderableShop('bio-validate-social-label');
      const res = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'SOCIAL_ICON', socialPlatform: 'instagram' })
        .expect(201);
      expect(body<BioLinkRow>(res).label).toBe('Instagram');
    });

    it("rejects creating a PRODUCT link against another shop's product id", async () => {
      const shopA = await setupOrderableShop('bio-cross-product-a');
      const shopB = await setupOrderableShop('bio-cross-product-b');
      await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          type: 'PRODUCT',
          label: 'Not mine',
          productId: shopB.productId,
        })
        .expect(404);
    });
  });

  describe('CRUD + type-switch clearing', () => {
    it('creates, lists, updates (switching type clears the old target field), and deletes', async () => {
      const shop = await setupOrderableShop('bio-crud');

      const created = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'My Site',
          url: 'https://example.com',
        })
        .expect(201);
      const link = body<BioLinkRow>(created);
      expect(link.url).toBe('https://example.com');
      expect(link.productId).toBeNull();

      const list = await request(app.getHttpServer())
        .get('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<BioLinkRow[]>(list).some((l) => l.id === link.id)).toBe(true);

      const updated = await request(app.getHttpServer())
        .patch(`/shop/bio-links/${link.id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'PRODUCT', label: 'Buy Rose', productId: shop.productId })
        .expect(200);
      const updatedLink = body<BioLinkRow>(updated);
      expect(updatedLink.productId).toBe(shop.productId);
      expect(updatedLink.url).toBeNull(); // cleared, not left stale from the old EXTERNAL_URL state
      expect(updatedLink.productName).toBe('Rose');

      await request(app.getHttpServer())
        .delete(`/shop/bio-links/${link.id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const afterDelete = await request(app.getHttpServer())
        .get('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(
        body<BioLinkRow[]>(afterDelete).some((l) => l.id === link.id),
      ).toBe(false);
    });

    it('a label-only update does not require resending the target field', async () => {
      const shop = await setupOrderableShop('bio-partial-update');
      const created = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'Old Label',
          url: 'https://example.com',
        })
        .expect(201);
      const linkId = body<BioLinkRow>(created).id;

      const updated = await request(app.getHttpServer())
        .patch(`/shop/bio-links/${linkId}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ label: 'New Label' })
        .expect(200);
      expect(body<BioLinkRow>(updated).label).toBe('New Label');
      expect(body<BioLinkRow>(updated).url).toBe('https://example.com');
    });
  });

  describe('reorder', () => {
    it('persists a new order and findAll reflects it', async () => {
      const shop = await setupOrderableShop('bio-reorder');
      const ids: number[] = [];
      for (const label of ['First', 'Second', 'Third']) {
        const res = await request(app.getHttpServer())
          .post('/shop/bio-links')
          .set('Authorization', `Bearer ${shop.adminToken}`)
          .send({ type: 'EXTERNAL_URL', label, url: 'https://example.com' })
          .expect(201);
        ids.push(body<BioLinkRow>(res).id);
      }

      const reversed = [...ids].reverse();
      const reorderRes = await request(app.getHttpServer())
        .patch('/shop/bio-links/reorder')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ ids: reversed })
        .expect(200);
      expect(body<BioLinkRow[]>(reorderRes).map((l) => l.id)).toEqual(reversed);

      const list = await request(app.getHttpServer())
        .get('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<BioLinkRow[]>(list).map((l) => l.id)).toEqual(reversed);
    });

    it("rejects a reorder whose id set does not exactly match the shop's own links", async () => {
      const shopA = await setupOrderableShop('bio-reorder-cross-a');
      const shopB = await setupOrderableShop('bio-reorder-cross-b');
      const linkA = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'A Link',
          url: 'https://example.com',
        })
        .expect(201);
      const linkB = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'B Link',
          url: 'https://example.com',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/shop/bio-links/reorder')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ ids: [body<BioLinkRow>(linkB).id] })
        .expect(400);

      // shop B's link order is untouched by the rejected attempt.
      const listB = await request(app.getHttpServer())
        .get('/shop/bio-links')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(
        body<BioLinkRow[]>(listB).find(
          (l) => l.id === body<BioLinkRow>(linkB).id,
        )?.order,
      ).toBe(0);
      void linkA;
    });
  });

  describe('tenant isolation', () => {
    it("shop A cannot read, update, or delete shop B's bio link by id", async () => {
      const shopA = await setupOrderableShop('bio-tenant-a');
      const shopB = await setupOrderableShop('bio-tenant-b');
      const linkB = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'B Link',
          url: 'https://example.com',
        })
        .expect(201);
      const linkBId = body<BioLinkRow>(linkB).id;

      const listA = await request(app.getHttpServer())
        .get('/shop/bio-links')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<BioLinkRow[]>(listA).some((l) => l.id === linkBId)).toBe(
        false,
      );

      await request(app.getHttpServer())
        .patch(`/shop/bio-links/${linkBId}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ label: 'Hijacked' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/shop/bio-links/${linkBId}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(404);

      // Untouched by the rejected attempts.
      const stillThere = await request(app.getHttpServer())
        .get('/shop/bio-links')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(
        body<BioLinkRow[]>(stillThere).find((l) => l.id === linkBId)?.label,
      ).toBe('B Link');
    });
  });

  describe('public list endpoint', () => {
    it('404s for an unpublished shop', async () => {
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'Unpublished Admin',
          email: `bio-unpublished-${runId}@test.com`,
          password: 'password123',
          shopName: 'Unpublished Shop',
          subdomain: `bio-unpublished-${runId}`,
        })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/public/bio-unpublished-${runId}/bio-links`)
        .expect(404);
      void signup;
    });

    it('excludes inactive links, a deleted-product link, and an unavailable-product link — includes everything else', async () => {
      const shop = await setupOrderableShop('bio-public-exclusions');

      const activeExternal = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'Active Link',
          url: 'https://example.com',
        })
        .expect(201);

      const inactiveLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'Inactive Link',
          url: 'https://example.com',
          active: false,
        })
        .expect(201);

      // A product that will be deleted after the bio link is created.
      const doomedProduct = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Doomed Product',
          price: 10,
          thumbnail: 'https://example.com/doomed.jpg',
          sku: `DOOMED-${runId}`,
          collectionIds: [shop.collectionId],
        })
        .expect(201);
      const doomedProductLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'PRODUCT',
          label: 'Doomed',
          productId: body<IdRow>(doomedProduct).id,
        })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/products/${body<IdRow>(doomedProduct).id}`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);

      // A product made unavailable after the bio link is created.
      const unavailableProduct = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Unavailable Product',
          price: 10,
          thumbnail: 'https://example.com/unavailable.jpg',
          sku: `UNAVAIL-${runId}`,
          collectionIds: [shop.collectionId],
        })
        .expect(201);
      const unavailableProductLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'PRODUCT',
          label: 'Unavailable',
          productId: body<IdRow>(unavailableProduct).id,
        })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/products/${body<IdRow>(unavailableProduct).id}/availability`)
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ status: 'Unavailable' })
        .expect(200);

      const collectionLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'COLLECTION',
          label: 'Shop Flowers',
          collectionId: shop.collectionId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/bio-links`)
        .expect(200);
      const publicLinks = body<PublicBioLinkRow[]>(res);
      const ids = publicLinks.map((l) => l.id);

      expect(ids).toContain(body<BioLinkRow>(activeExternal).id);
      expect(ids).toContain(body<BioLinkRow>(collectionLink).id);
      expect(ids).not.toContain(body<BioLinkRow>(inactiveLink).id);
      expect(ids).not.toContain(body<BioLinkRow>(doomedProductLink).id);
      expect(ids).not.toContain(body<BioLinkRow>(unavailableProductLink).id);

      const collectionEntry = publicLinks.find(
        (l) => l.id === body<BioLinkRow>(collectionLink).id,
      );
      expect(collectionEntry?.collection?.name).toBe('Flowers');
    });

    it('resolves a TEMPLATE link, and excludes one pointing at an inactive template', async () => {
      const shop = await setupOrderableShop('bio-public-template');
      const activeTemplate = await request(app.getHttpServer())
        .post('/templates')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ title: 'Active Template', type: 'MANUAL', isActive: true })
        .expect(201);
      const inactiveTemplate = await request(app.getHttpServer())
        .post('/templates')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ title: 'Inactive Template', type: 'MANUAL', isActive: false })
        .expect(201);

      const activeLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'TEMPLATE',
          label: 'Shop It',
          templateId: body<IdRow>(activeTemplate).id,
        })
        .expect(201);
      const inactiveLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'TEMPLATE',
          label: 'Hidden',
          templateId: body<IdRow>(inactiveTemplate).id,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/bio-links`)
        .expect(200);
      const publicLinks = body<PublicBioLinkRow[]>(res);
      const ids = publicLinks.map((l) => l.id);
      expect(ids).toContain(body<BioLinkRow>(activeLink).id);
      expect(ids).not.toContain(body<BioLinkRow>(inactiveLink).id);

      const entry = publicLinks.find(
        (l) => l.id === body<BioLinkRow>(activeLink).id,
      );
      expect(entry?.template?.title).toBe('Active Template');
    });

    it('resolves a SOCIAL_ICON link from shop.socialLinks, and excludes one whose platform was never configured', async () => {
      const shop = await setupOrderableShop('bio-public-social');
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ socialLinks: { instagram: 'https://instagram.com/example' } })
        .expect(200);

      const configuredLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'SOCIAL_ICON', socialPlatform: 'instagram' })
        .expect(201);
      const unconfiguredLink = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'SOCIAL_ICON', socialPlatform: 'snapchat' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}/bio-links`)
        .expect(200);
      const ids = body<PublicBioLinkRow[]>(res).map((l) => l.id);
      expect(ids).toContain(body<BioLinkRow>(configuredLink).id);
      expect(ids).not.toContain(body<BioLinkRow>(unconfiguredLink).id);
    });
  });

  describe('click redirect endpoint', () => {
    it('redirects EXTERNAL_URL to the stored url and increments clickCount', async () => {
      const shop = await setupOrderableShop('bio-click-external');
      const link = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'External',
          url: 'https://example.com/landing',
        })
        .expect(201);
      const linkId = body<BioLinkRow>(link).id;

      const res = await request(app.getHttpServer())
        .get(`/public/bio-links/${linkId}/click`)
        .expect(302);
      expect(res.headers.location).toBe('https://example.com/landing');

      const row = await getBiolink(linkId);
      expect(row.clickCount).toBe(1);
    });

    it('redirects PRODUCT to the storefront product page', async () => {
      const shop = await setupOrderableShop('bio-click-product');
      const link = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ type: 'PRODUCT', label: 'Buy Rose', productId: shop.productId })
        .expect(201);
      const linkId = body<BioLinkRow>(link).id;

      const res = await request(app.getHttpServer())
        .get(`/public/bio-links/${linkId}/click`)
        .expect(302);
      expect(res.headers.location).toContain(`/${shop.slug}/products/`);
    });

    it('redirects TEMPLATE to the storefront template page', async () => {
      const shop = await setupOrderableShop('bio-click-template');
      const template = await request(app.getHttpServer())
        .post('/templates')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ title: 'Click Target', type: 'MANUAL', isActive: true })
        .expect(201);
      const link = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'TEMPLATE',
          label: 'Shop It',
          templateId: body<IdRow>(template).id,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/public/bio-links/${body<BioLinkRow>(link).id}/click`)
        .expect(302);
      expect(res.headers.location).toBe(
        `http://localhost:3002/${shop.slug}/templates/click-target`,
      );
    });

    it('rejects a click on an inactive link', async () => {
      const shop = await setupOrderableShop('bio-click-inactive');
      const link = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'Inactive',
          url: 'https://example.com',
          active: false,
        })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/public/bio-links/${body<BioLinkRow>(link).id}/click`)
        .expect(404);
    });

    it('rejects a click for a link belonging to an unpublished shop', async () => {
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'Unpublished Admin',
          email: `bio-click-unpub-${runId}@test.com`,
          password: 'password123',
          shopName: 'Unpublished Click Shop',
          subdomain: `bio-click-unpub-${runId}`,
        })
        .expect(201);
      const adminToken = body<AuthResponse>(signup).accessToken;
      const link = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'Unpub',
          url: 'https://example.com',
        })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/public/bio-links/${body<BioLinkRow>(link).id}/click`)
        .expect(404);
    });

    // Explicit timeout (same fix jobs.e2e-spec.ts already documents for its
    // own concurrency test): setupOrderableShop's own sequential HTTP calls
    // plus 8 real concurrent requests against the shared CI MySQL container
    // can exceed Jest's 5s default under a loaded/shared runner — seen for
    // real (2026-08-11, first post-merge run on main): Jest's timeout fired
    // mid-test, afterAll then closed the app/DB pool while requests were
    // still in flight, surfacing as "Pool is closed" / ECONNRESET rather
    // than a clean timeout message. Not an application bug — resolveClickTarget's
    // own UPDATE clickCount = clickCount + 1 is already atomic at the SQL
    // level regardless of concurrency; this only gives the test itself more
    // real-world headroom.
    it('increments clickCount atomically under concurrent requests — no lost updates', async () => {
      const shop = await setupOrderableShop('bio-click-race');
      const link = await request(app.getHttpServer())
        .post('/shop/bio-links')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          type: 'EXTERNAL_URL',
          label: 'Race',
          url: 'https://example.com',
        })
        .expect(201);
      const linkId = body<BioLinkRow>(link).id;

      const attempt = () =>
        request(app.getHttpServer()).get(`/public/bio-links/${linkId}/click`);
      const CONCURRENCY = 8;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, attempt),
      );
      expect(results.every((r) => r.status === 302)).toBe(true);

      const row = await getBiolink(linkId);
      expect(row.clickCount).toBe(CONCURRENCY);
    }, 20000);
  });
});
