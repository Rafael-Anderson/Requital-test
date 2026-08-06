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
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface IngredientRow {
  id: number;
  name: string;
  unit: string;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}
interface MovementRow {
  id: number;
  productId: number | null;
  productName: string | null;
  ingredientId: number | null;
  ingredientName: string | null;
  ingredientUnit: string | null;
  type: string;
  delta: number;
}
interface MovementList {
  data: MovementRow[];
  total: number;
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

describe('Ingredients: CRUD, stock movements, tenant isolation (e2e)', () => {
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
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Ingredients Test Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<AuthResponse>(signup).accessToken;
    await verifySignupEmail(
      app.getHttpServer(),
      body<AuthResponse>(signup).devVerificationLink,
    );

    const outlets = await request(app.getHttpServer())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletA = body<OutletRow[]>(outlets)[0].id;

    const outletBRes = await request(app.getHttpServer())
      .post('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Ingredient Outlet B ${slug}` })
      .expect(201);
    const outletB = body<IdRow>(outletBRes).id;

    return { adminToken, outletA, outletB, slug };
  }

  async function createIngredient(
    adminToken: string,
    name: string,
    unit = 'stems',
  ) {
    const res = await request(app.getHttpServer())
      .post('/shop/ingredients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, unit })
      .expect(201);
    return body<IngredientRow>(res);
  }

  describe('CRUD', () => {
    it('creates, lists, updates, and deletes an ingredient', async () => {
      const { adminToken } = await setupShop('crud');
      const created = await createIngredient(adminToken, 'Red Roses', 'stems');
      expect(created.name).toBe('Red Roses');
      expect(created.unit).toBe('stems');

      const list = await request(app.getHttpServer())
        .get('/shop/ingredients')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<IngredientRow[]>(list).some((i) => i.id === created.id)).toBe(
        true,
      );

      await request(app.getHttpServer())
        .patch(`/shop/ingredients/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'White Roses' })
        .expect(200);

      const fetched = await request(app.getHttpServer())
        .get(`/shop/ingredients/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<IngredientRow>(fetched).name).toBe('White Roses');

      await request(app.getHttpServer())
        .delete(`/shop/ingredients/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/shop/ingredients/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('a branch user can read ingredients but cannot create, update, or delete one', async () => {
      const { adminToken, outletA } = await setupShop('crud-branch');
      const ingredient = await createIngredient(adminToken, 'Packaging Box');

      const branchEmail = `crud-branch-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch Staff',
          email: branchEmail,
          password: 'password123',
          outletId: outletA,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: branchEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/shop/ingredients')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/shop/ingredients')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Sneaky Ingredient', unit: 'pieces' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/shop/ingredients/${ingredient.id}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Renamed by branch' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/shop/ingredients/${ingredient.id}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });
  });

  describe('tenant isolation', () => {
    it("cannot read, update, or delete another shop's ingredient by spoofing its id", async () => {
      const shopA = await setupShop('iso-a');
      const shopB = await setupShop('iso-b');
      const ingredientA = await createIngredient(
        shopA.adminToken,
        'Shop A Ribbon',
      );

      await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredientA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/shop/ingredients/${ingredientA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/shop/ingredients/${ingredientA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);

      // Untouched — confirm the 404s were real rejections, not silent no-ops
      // that happened to also succeed.
      const stillThere = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredientA.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      expect(body<IngredientRow>(stillThere).name).toBe('Shop A Ribbon');
    });

    it("cannot transfer or adjust stock for another shop's ingredient by spoofing its id", async () => {
      const shopA = await setupShop('iso-stock-a');
      const shopB = await setupShop('iso-stock-b');
      const ingredientA = await createIngredient(
        shopA.adminToken,
        'Shop A Twine',
      );

      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          ingredientId: ingredientA.id,
          outletId: shopB.outletA,
          delta: 50,
          reason: 'received',
        })
        .expect(404);

      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          ingredientId: ingredientA.id,
          fromOutletId: shopB.outletA,
          toOutletId: shopB.outletB,
          quantity: 1,
        })
        .expect(404);
    });
  });

  describe('stock target validation', () => {
    it('rejects a stock request with neither productId nor ingredientId', async () => {
      const { adminToken, outletA } = await setupShop('validation-neither');
      const res = await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId: outletA, delta: 5, reason: 'received' })
        .expect(400);
      expect(
        messageContains(res, 'productId or ingredientId is required'),
      ).toBe(true);
    });

    it('rejects a stock request with both productId and ingredientId', async () => {
      const { adminToken, outletA } = await setupShop('validation-both');
      const ingredient = await createIngredient(adminToken, 'Both Test');
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'General' })
        .expect(201);
      const product = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Both Test Product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `BOTH-${runId}`,
          categoryIds: [body<IdRow>(category).id],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: body<IdRow>(product).id,
          ingredientId: ingredient.id,
          outletId: outletA,
          delta: 5,
          reason: 'received',
        })
        .expect(400);
      expect(messageContains(res, 'not both')).toBe(true);
    });

    it('rejects an ingredient stock request that also carries a variantId', async () => {
      const { adminToken, outletA } = await setupShop('validation-variant');
      const ingredient = await createIngredient(adminToken, 'Variant Test');
      const res = await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          variantId: 999,
          outletId: outletA,
          delta: 5,
          reason: 'received',
        })
        .expect(400);
      expect(messageContains(res, 'do not support variants')).toBe(true);
    });
  });

  describe('stock transfer + reason-coded adjustment against an ingredient', () => {
    it('adjusts ingredient stock with a reason and logs it to movement history', async () => {
      const { adminToken, outletA } = await setupShop('adjust');
      const ingredient = await createIngredient(
        adminToken,
        'Adjust Test Ribbon',
        'meters',
      );

      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          outletId: outletA,
          delta: 25,
          reason: 'received',
          note: 'PO #1',
        })
        .expect(201);

      const fetched = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredient.id}?outletId=${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<IngredientRow>(fetched).stockQuantity).toBe(25);

      const movements = await request(app.getHttpServer())
        .get(`/products/stock/movements?ingredientId=${ingredient.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const list = body<MovementList>(movements);
      expect(list.total).toBe(1);
      expect(list.data[0].ingredientName).toBe('Adjust Test Ribbon');
      expect(list.data[0].ingredientUnit).toBe('meters');
      expect(list.data[0].productId).toBeNull();
      expect(list.data[0].productName).toBeNull();
      expect(list.data[0].delta).toBe(25);
    });

    it('a negative adjustment cannot take ingredient stock below zero', async () => {
      const { adminToken, outletA } = await setupShop('adjust-floor');
      const ingredient = await createIngredient(adminToken, 'Floor Test');
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          outletId: outletA,
          delta: 10,
          reason: 'received',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          outletId: outletA,
          delta: -20,
          reason: 'damaged',
        })
        .expect(409);

      const fetched = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredient.id}?outletId=${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<IngredientRow>(fetched).stockQuantity).toBe(10);
    });

    it('transfers ingredient stock between two outlets and logs it', async () => {
      const { adminToken, outletA, outletB } = await setupShop('transfer');
      const ingredient = await createIngredient(adminToken, 'Transfer Test');
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          outletId: outletA,
          delta: 40,
          reason: 'received',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/products/stock/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          fromOutletId: outletA,
          toOutletId: outletB,
          quantity: 15,
        })
        .expect(201);

      const atA = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredient.id}?outletId=${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const atB = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredient.id}?outletId=${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<IngredientRow>(atA).stockQuantity).toBe(25);
      expect(body<IngredientRow>(atB).stockQuantity).toBe(15);

      const movements = await request(app.getHttpServer())
        .get(
          `/products/stock/movements?ingredientId=${ingredient.id}&type=TRANSFER`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<MovementList>(movements).total).toBe(1);
    });

    it('race: two concurrent transfers of 30 units each from an outlet with only 40 units of an ingredient — exactly one succeeds', async () => {
      const { adminToken, outletA, outletB } = await setupShop('transfer-race');
      const ingredient = await createIngredient(adminToken, 'Race Test');
      await request(app.getHttpServer())
        .post('/products/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ingredientId: ingredient.id,
          outletId: outletA,
          delta: 40,
          reason: 'received',
        })
        .expect(201);

      const attempt = () =>
        request(app.getHttpServer())
          .post('/products/stock/transfer')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            ingredientId: ingredient.id,
            fromOutletId: outletA,
            toOutletId: outletB,
            quantity: 30,
          });

      const results = await Promise.all([attempt(), attempt()]);
      const succeeded = results.filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);

      const atA = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredient.id}?outletId=${outletA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const atB = await request(app.getHttpServer())
        .get(`/shop/ingredients/${ingredient.id}?outletId=${outletB}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<IngredientRow>(atA).stockQuantity).toBe(10);
      expect(body<IngredientRow>(atB).stockQuantity).toBe(30);
    });
  });

  describe('never reachable via any public/storefront endpoint', () => {
    it("a published shop's public product listing never includes an ingredient, and creating one does not affect it", async () => {
      const { adminToken, slug } = await setupShop('public-leak');
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Public category' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Public Leak Test Product',
          price: 10,
          thumbnail: 'https://example.com/x.jpg',
          sku: `PUBLEAK-${runId}`,
          status: 'Available',
          categoryIds: [body<IdRow>(category).id],
        })
        .expect(201);
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/outlets/${body<OutletRow[]>(outlets)[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pickupEnabled: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);

      // A deliberately identically-named ingredient — if the public product
      // listing ever accidentally unioned in ingredients, this specific
      // name collision is the sharpest way to catch it.
      await createIngredient(
        adminToken,
        'Public Leak Test Ingredient',
        'grams',
      );

      const publicProducts = await request(app.getHttpServer())
        .get(`/public/${slug}/products`)
        .expect(200);
      const names = body<{ name: string }[]>(publicProducts).map((p) => p.name);
      expect(names).toContain('Public Leak Test Product');
      expect(names).not.toContain('Public Leak Test Ingredient');
    });
  });

  describe('detail fields (image/description/cost/supplier)', () => {
    it('creates and updates an ingredient with the fuller field set, including image via the upload endpoint', async () => {
      const { adminToken } = await setupShop('detail-fields');

      // A real, valid 1x1 PNG — Phase 6's upload pipeline sniffs actual
      // magic bytes now, not the client-declared filename/Content-Type, so
      // plain text bytes (the previous stub here) would be correctly
      // rejected regardless of the ".jpg" filename attached below.
      const validPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      const upload = await request(app.getHttpServer())
        .post('/shop/ingredients/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', validPng, 'rose.jpg')
        .expect(201);
      const { url } = body<{ url: string }>(upload);
      expect(url).toMatch(/^\/uploads\/ingredients\//);

      const created = await request(app.getHttpServer())
        .post('/shop/ingredients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Detailed Rose',
          unit: 'stems',
          image: url,
          description: 'Fresh-cut red roses',
          costPerUnit: 2.5,
          supplier: 'Dubai Flower Market',
        })
        .expect(201);
      const ingredient = body<{
        id: number;
        image: string | null;
        description: string | null;
        costPerUnit: string | null;
        supplier: string | null;
      }>(created);
      expect(ingredient.image).toBe(url);
      expect(ingredient.description).toBe('Fresh-cut red roses');
      expect(Number(ingredient.costPerUnit)).toBe(2.5);
      expect(ingredient.supplier).toBe('Dubai Flower Market');

      // Explicit null clears each field — same convention as CategoryDto.
      const updated = await request(app.getHttpServer())
        .patch(`/shop/ingredients/${ingredient.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          image: null,
          description: null,
          costPerUnit: null,
          supplier: null,
        })
        .expect(200);
      const cleared = body<{
        image: string | null;
        description: string | null;
        costPerUnit: string | null;
        supplier: string | null;
      }>(updated);
      expect(cleared.image).toBeNull();
      expect(cleared.description).toBeNull();
      expect(cleared.costPerUnit).toBeNull();
      expect(cleared.supplier).toBeNull();
    });
  });

  describe('Ingredient Categories', () => {
    async function createCategory(adminToken: string, name: string) {
      const res = await request(app.getHttpServer())
        .post('/shop/ingredient-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name })
        .expect(201);
      return body<IdRow>(res);
    }

    it('creates, lists, updates, and deletes an ingredient category', async () => {
      const { adminToken } = await setupShop('cat-crud');
      const category = await createCategory(adminToken, 'Florals');

      const list = await request(app.getHttpServer())
        .get('/shop/ingredient-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        body<{ id: number; name: string }[]>(list).some(
          (c) => c.id === category.id,
        ),
      ).toBe(true);

      await request(app.getHttpServer())
        .patch(`/shop/ingredient-categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fresh Florals' })
        .expect(200);

      const listAfterRename = await request(app.getHttpServer())
        .get('/shop/ingredient-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        body<{ id: number; name: string }[]>(listAfterRename).find(
          (c) => c.id === category.id,
        )?.name,
      ).toBe('Fresh Florals');

      await request(app.getHttpServer())
        .delete(`/shop/ingredient-categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('a branch user can read categories but cannot create, update, or delete one', async () => {
      const { adminToken, outletA } = await setupShop('cat-branch');
      const category = await createCategory(adminToken, 'Packaging');

      const staffEmail = `cat-branch-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Branch Staff',
          email: staffEmail,
          password: 'password123',
          role: 'branch',
          outletId: outletA,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/shop/ingredient-categories')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/shop/ingredient-categories')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Sneaky Category' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/shop/ingredient-categories/${category.id}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ name: 'Renamed by branch' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/shop/ingredient-categories/${category.id}`)
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
    });

    it('cannot delete a category that still has ingredients assigned', async () => {
      const { adminToken } = await setupShop('cat-delete-blocked');
      const category = await createCategory(adminToken, 'In Use');
      await request(app.getHttpServer())
        .post('/shop/ingredients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Assigned Ingredient',
          unit: 'grams',
          categoryId: category.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/shop/ingredient-categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it("filters the ingredient list by categoryId, and the BOM picker's search can rely on it", async () => {
      const { adminToken } = await setupShop('cat-filter');
      const florals = await createCategory(adminToken, 'Florals');
      const packaging = await createCategory(adminToken, 'Packaging');
      const rose = await createIngredient(
        adminToken,
        'Rose (filter test)',
        'stems',
      );
      await request(app.getHttpServer())
        .patch(`/shop/ingredients/${rose.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoryId: florals.id })
        .expect(200);
      const box = await createIngredient(
        adminToken,
        'Box (filter test)',
        'pieces',
      );
      await request(app.getHttpServer())
        .patch(`/shop/ingredients/${box.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoryId: packaging.id })
        .expect(200);

      const floralsOnly = await request(app.getHttpServer())
        .get(`/shop/ingredients?categoryId=${florals.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const floralIds = body<{ id: number }[]>(floralsOnly).map((i) => i.id);
      expect(floralIds).toContain(rose.id);
      expect(floralIds).not.toContain(box.id);
    });

    it('rejects a categoryId that belongs to a different shop', async () => {
      const shopA = await setupShop('cat-tenant-a');
      const shopB = await setupShop('cat-tenant-b');
      const categoryB = await createCategory(
        shopB.adminToken,
        'Shop B Category',
      );

      await request(app.getHttpServer())
        .post('/shop/ingredients')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          name: 'Cross-tenant attempt',
          unit: 'grams',
          categoryId: categoryB.id,
        })
        .expect(404);
    });

    it("adversarial: cannot read, rename, or delete another shop's ingredient category by spoofing its id", async () => {
      const shopA = await setupShop('cat-iso-a');
      const shopB = await setupShop('cat-iso-b');
      const categoryA = await createCategory(shopA.adminToken, 'Shop A Only');

      await request(app.getHttpServer())
        .patch(`/shop/ingredient-categories/${categoryA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/shop/ingredient-categories/${categoryA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);

      const listB = await request(app.getHttpServer())
        .get('/shop/ingredient-categories')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(
        body<{ id: number }[]>(listB).some((c) => c.id === categoryA.id),
      ).toBe(false);
    });
  });
});
