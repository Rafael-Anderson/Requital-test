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
interface OutletRow {
  id: number;
}
interface ProductRow {
  id: number;
  name: string;
}
interface CollectionRow {
  id: number;
  title: string;
  slug: string;
  type: string;
  isActive: boolean;
  productCount: number;
  productIds?: number[];
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

describe('Collections (e2e)', () => {
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
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Collections Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<OutletRow[]>(outlets)[0].id;

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    return { adminToken, slug, outletId, categoryId };
  }

  async function createProduct(
    adminToken: string,
    categoryId: number,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Item ${Math.random()}`,
        price: 50,
        thumbnail: 'https://example.com/x.jpg',
        sku: `COLL-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'Available',
        categoryIds: [categoryId],
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  describe('admin CRUD', () => {
    it('creates, lists, updates, and deletes a MANUAL collection', async () => {
      const { adminToken } = await setupShop('crud');
      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Summer Sale', type: 'MANUAL' })
        .expect(201);
      const collection = body<CollectionRow>(created);
      expect(collection.slug).toBe('summer-sale');

      const list = await request(app.getHttpServer())
        .get('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<CollectionRow[]>(list).some((c) => c.id === collection.id)).toBe(true);

      await request(app.getHttpServer())
        .patch(`/collections/${collection.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Winter Sale' })
        .expect(200);

      const fetched = await request(app.getHttpServer())
        .get(`/collections/${collection.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<CollectionRow>(fetched).title).toBe('Winter Sale');

      await request(app.getHttpServer())
        .delete(`/collections/${collection.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/collections/${collection.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('a branch user cannot create, update, or delete a collection (admin-only, same tier as Categories)', async () => {
      const { adminToken, outletId } = await setupShop('crud-branch');
      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Admin Only', type: 'MANUAL' })
        .expect(201);
      const collectionId = body<CollectionRow>(created).id;

      const branchEmail = `crud-branch-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Branch Staff', email: branchEmail, password: 'password123', outletId })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: branchEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ title: 'Sneaky', type: 'MANUAL' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ title: 'Hijacked' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });

    it('rejects a RULE_BASED collection with no rule conditions set', async () => {
      const { adminToken } = await setupShop('validate-empty-rules');
      const res = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Empty Rules', type: 'RULE_BASED' })
        .expect(400);
      expect(messageContains(res, 'at least one rule condition')).toBe(true);
    });

    it('rejects a MANUAL collection that also carries rules', async () => {
      const { adminToken } = await setupShop('validate-manual-rules');
      const res = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Manual With Rules', type: 'MANUAL', rules: { maxPrice: 50 } })
        .expect(400);
      expect(messageContains(res, "only be set when type is 'RULE_BASED'")).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('cannot read, update, delete, or set products on another shop\'s collection by spoofing its id', async () => {
      const shopA = await setupShop('iso-a');
      const shopB = await setupShop('iso-b');
      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ title: 'Shop A Collection', type: 'MANUAL' })
        .expect(201);
      const collectionId = body<CollectionRow>(created).id;

      await request(app.getHttpServer())
        .get(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ title: 'Hijacked' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/collections/${collectionId}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .put(`/collections/${collectionId}/products`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ products: [] })
        .expect(404);
    });

    it('setProducts rejects a productId belonging to another shop', async () => {
      const shopA = await setupShop('iso-stock-a');
      const shopB = await setupShop('iso-stock-b');
      const productB = await createProduct(shopB.adminToken, shopB.categoryId);
      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ title: 'Shop A Manual', type: 'MANUAL' })
        .expect(201);
      const collectionId = body<CollectionRow>(created).id;

      const res = await request(app.getHttpServer())
        .put(`/collections/${collectionId}/products`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ products: [{ productId: productB.id, sortOrder: 0 }] })
        .expect(400);
      expect(messageContains(res, 'invalid for this shop')).toBe(true);
    });
  });

  describe('MANUAL collections', () => {
    it('setProducts is a full replace and manual order persists through the public endpoint', async () => {
      const { adminToken, slug, outletId, categoryId } = await setupShop('manual-order');
      const p1 = await createProduct(adminToken, categoryId, { name: 'Alpha' });
      const p2 = await createProduct(adminToken, categoryId, { name: 'Beta' });
      const p3 = await createProduct(adminToken, categoryId, { name: 'Gamma' });

      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Ordered', type: 'MANUAL', isActive: true })
        .expect(201);
      const collectionId = body<CollectionRow>(created).id;

      // Deliberately reversed order: Gamma(0), Alpha(1), Beta(2).
      await request(app.getHttpServer())
        .put(`/collections/${collectionId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          products: [
            { productId: p3.id, sortOrder: 0 },
            { productId: p1.id, sortOrder: 1 },
            { productId: p2.id, sortOrder: 2 },
          ],
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/outlets/' + outletId)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pickupEnabled: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);

      const publicRes = await request(app.getHttpServer())
        .get(`/public/${slug}/collections/ordered`)
        .expect(200);
      const names = body<{ products: { name: string }[] }>(publicRes).products.map((p) => p.name);
      expect(names).toEqual(['Gamma', 'Alpha', 'Beta']);

      // Full-replace: dropping p2 and re-saving must remove it, not merge.
      await request(app.getHttpServer())
        .put(`/collections/${collectionId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ products: [{ productId: p1.id, sortOrder: 0 }] })
        .expect(200);
      const afterReplace = await request(app.getHttpServer())
        .get(`/public/${slug}/collections/ordered`)
        .expect(200);
      expect(body<{ products: { name: string }[] }>(afterReplace).products.map((p) => p.name)).toEqual(['Alpha']);
    });
  });

  describe('RULE_BASED collections', () => {
    async function publishShop(adminToken: string, outletId: number) {
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pickupEnabled: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
    }

    it('auto-includes products by price range (maxPrice)', async () => {
      const { adminToken, slug, outletId, categoryId } = await setupShop('rule-price');
      const cheap = await createProduct(adminToken, categoryId, { name: 'Cheap', price: 20 });
      await createProduct(adminToken, categoryId, { name: 'Expensive', price: 500 });
      await publishShop(adminToken, outletId);

      const created = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Under 50 AED', type: 'RULE_BASED', rules: { maxPrice: 50 }, isActive: true })
        .expect(201);
      expect(body<CollectionRow>(created).productCount).toBe(1);

      const publicRes = await request(app.getHttpServer())
        .get(`/public/${slug}/collections/under-50-aed`)
        .expect(200);
      const names = body<{ products: { id: number; name: string }[] }>(publicRes).products;
      expect(names).toHaveLength(1);
      expect(names[0].id).toBe(cheap.id);
    });

    it('auto-includes products by category', async () => {
      const { adminToken, slug, outletId, categoryId } = await setupShop('rule-category');
      const other = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Other' })
        .expect(201);
      const inCat = await createProduct(adminToken, categoryId, { name: 'In Category' });
      await createProduct(adminToken, body<IdRow>(other).id, { name: 'Other Category' });
      await publishShop(adminToken, outletId);

      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Category Rule', type: 'RULE_BASED', rules: { categoryId }, isActive: true })
        .expect(201);

      const publicRes = await request(app.getHttpServer())
        .get(`/public/${slug}/collections/category-rule`)
        .expect(200);
      const products = body<{ products: { id: number }[] }>(publicRes).products;
      expect(products.map((p) => p.id)).toEqual([inCat.id]);
    });

    it('membership updates live when a product changes, without touching the collection', async () => {
      const { adminToken, slug, outletId, categoryId } = await setupShop('rule-live');
      const p = await createProduct(adminToken, categoryId, { name: 'Movable', price: 100 });
      await publishShop(adminToken, outletId);

      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Cheap Stuff', type: 'RULE_BASED', rules: { maxPrice: 50 }, isActive: true })
        .expect(201);

      const before = await request(app.getHttpServer()).get(`/public/${slug}/collections/cheap-stuff`).expect(200);
      expect(body<{ products: unknown[] }>(before).products).toHaveLength(0);

      await request(app.getHttpServer())
        .patch(`/products/${p.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 30 })
        .expect(200);

      const after = await request(app.getHttpServer()).get(`/public/${slug}/collections/cheap-stuff`).expect(200);
      expect(body<{ products: { id: number }[] }>(after).products.map((x) => x.id)).toEqual([p.id]);
    });
  });

  describe('public endpoints', () => {
    it('lists only active collections and 404s for an inactive/nonexistent one', async () => {
      const { adminToken, slug, outletId, categoryId } = await setupShop('public-active');
      await createProduct(adminToken, categoryId);
      await publishShopHelper(adminToken, outletId);

      await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Visible', type: 'RULE_BASED', rules: { maxPrice: 999999 }, isActive: true })
        .expect(201);
      const inactive = await request(app.getHttpServer())
        .post('/collections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Hidden', type: 'RULE_BASED', rules: { maxPrice: 999999 }, isActive: false })
        .expect(201);

      const list = await request(app.getHttpServer()).get(`/public/${slug}/collections`).expect(200);
      const titles = body<{ title: string }[]>(list).map((c) => c.title);
      expect(titles).toContain('Visible');
      expect(titles).not.toContain('Hidden');

      await request(app.getHttpServer())
        .get(`/public/${slug}/collections/${body<CollectionRow>(inactive).slug}`)
        .expect(404);
      await request(app.getHttpServer()).get(`/public/${slug}/collections/does-not-exist`).expect(404);
    });

    async function publishShopHelper(adminToken: string, outletId: number) {
      await request(app.getHttpServer())
        .patch(`/outlets/${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pickupEnabled: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
    }
  });
});
