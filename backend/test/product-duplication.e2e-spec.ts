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
interface VariantRow {
  id: number;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  label: string | null;
  imageId: number | null;
  imageUrl: string | null;
  optionValue1Id: number | null;
  stockQuantity: number | null;
}
interface OptionRow {
  id: number;
  name: string;
  values: { id: number; value: string }[];
}
interface ProductRow {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  status: string;
  price: string;
  description: string | null;
  thumbnail: string;
  hasVariants: boolean;
  options: OptionRow[];
  variants: VariantRow[];
  images: { id: number; url: string; order: number }[];
  categories: { id: number }[];
  stockQuantity: number | null;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Product duplication (e2e)', () => {
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
        name: 'Dup Test Admin',
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

    return { adminToken, outletId, categoryId };
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
        name: `Dup Item ${Math.random()}`,
        price: 100,
        thumbnail: 'https://example.com/original.jpg',
        sku: `DUP-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
        status: 'Available',
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  describe('simple product (no variants)', () => {
    it('copies title/description/pricing/category, leaves sku suffixed + barcode blank, forces status to Draft, never copies stock', async () => {
      const { adminToken, outletId, categoryId } = await setupShop('simple');
      const original = await createProduct(adminToken, categoryId, {
        description: 'The original description',
        price: 42.5,
        compareAtPrice: 60,
        barcode: '1234567890',
        trackInventory: true,
      });

      // Give the original real stock — the duplicate must NOT inherit it.
      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outletId,
          adjustments: [{ productId: original.id, delta: 25 }],
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/products/${original.id}/duplicate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const copy = body<ProductRow>(res);

      expect(copy.id).not.toBe(original.id);
      expect(copy.name).toBe(`${original.name} (Copy)`);
      expect(copy.description).toBe('The original description');
      expect(copy.price).toBe('42.5');
      expect(copy.categories.map((c) => c.id)).toEqual([categoryId]);
      expect(copy.thumbnail).toBe(original.thumbnail);

      // SKU: not verbatim (would collide with the @@unique([shopId, sku])
      // constraint), suffixed instead — never literally blank because the
      // column is NOT NULL + unique, unlike barcode.
      expect(copy.sku).not.toBe(original.sku);
      expect(copy.sku.startsWith(original.sku)).toBe(true);
      expect(copy.barcode).toBeNull();

      // Always Draft (= 'Unavailable') regardless of the original's status.
      expect(copy.status).toBe('Unavailable');

      // Inventory never carries over — the original has 25 units at this
      // outlet, the copy must show none (no outletstock row created at all).
      const copyDetail = await request(app.getHttpServer())
        .get(`/products/${copy.id}?outletId=${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(copyDetail).stockQuantity).toBeNull();

      const originalDetail = await request(app.getHttpServer())
        .get(`/products/${original.id}?outletId=${outletId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(originalDetail).stockQuantity).toBe(25);
    });

    it('duplicating the same product twice does not collide on sku/slug', async () => {
      const { adminToken, categoryId } = await setupShop('twice');
      const original = await createProduct(adminToken, categoryId);

      const first = await request(app.getHttpServer())
        .post(`/products/${original.id}/duplicate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/products/${original.id}/duplicate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(body<ProductRow>(first).sku).not.toBe(
        body<ProductRow>(second).sku,
      );
      expect(body<ProductRow>(first).id).not.toBe(body<ProductRow>(second).id);
    });
  });

  describe('variants/options + media', () => {
    it('deep-copies options, variants (price copied, sku/barcode blank), and re-links variant images to the new copies', async () => {
      const { adminToken, categoryId } = await setupShop('variants');
      const original = await createProduct(adminToken, categoryId, {
        price: 30,
        images: [
          { url: 'https://example.com/red.jpg', order: 0 },
          { url: 'https://example.com/blue.jpg', order: 1 },
        ],
      });

      await request(app.getHttpServer())
        .put(`/products/${original.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Color', values: ['Red', 'Blue'] }] })
        .expect(200);

      const withVariants = await request(app.getHttpServer())
        .get(`/products/${original.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const originalProduct = body<ProductRow>(withVariants);
      const redVariant = originalProduct.variants.find(
        (v) => v.label === 'Red',
      )!;
      const redImage = originalProduct.images.find((i) =>
        i.url.includes('red'),
      )!;

      // Point the Red variant at the red image, and give both variants a
      // distinct price, so the copy's fidelity is actually verifiable.
      await request(app.getHttpServer())
        .patch(`/products/${original.id}/variants/${redVariant.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 33, sku: 'RED-SKU-ORIGINAL', imageId: redImage.id })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/products/${original.id}/duplicate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      const copy = body<ProductRow>(res);

      expect(copy.hasVariants).toBe(true);
      expect(copy.options).toHaveLength(1);
      expect(copy.options[0].name).toBe('Color');
      expect(copy.options[0].values.map((v) => v.value).sort()).toEqual([
        'Blue',
        'Red',
      ]);
      // New option-value ids, not reused from the original product.
      expect(
        copy.options[0].values.every(
          (v) =>
            !originalProduct.options[0].values.some((ov) => ov.id === v.id),
        ),
      ).toBe(true);

      expect(copy.variants).toHaveLength(2);
      const copyRed = copy.variants.find((v) => v.label === 'Red')!;
      expect(copyRed).toBeTruthy();
      expect(copyRed.price).toBe('33');
      // Variant sku/barcode ARE left genuinely blank (no uniqueness
      // constraint on them, unlike the product-level sku).
      expect(copyRed.sku).toBeNull();
      expect(copyRed.barcode).toBeNull();
      // Image reference correctly re-linked to the COPY's own red image,
      // not the original product's image row.
      expect(copy.images.some((i) => i.id === copyRed.imageId)).toBe(true);
      expect(copyRed.imageId).not.toBe(redImage.id);
      expect(copyRed.imageUrl).toBe('https://example.com/red.jpg');

      // Never copies stock for variants either.
      expect(copyRed.stockQuantity).toBeNull();
    });
  });

  describe('tenant isolation + role enforcement', () => {
    it("an admin from shop B cannot duplicate shop A's product", async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      const productA = await createProduct(shopA.adminToken, shopA.categoryId);

      await request(app.getHttpServer())
        .post(`/products/${productA.id}/duplicate`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
    });

    it('a non-admin role cannot duplicate a product (same gate as create/update/delete)', async () => {
      const { adminToken, categoryId } = await setupShop('role-gate');
      const product = await createProduct(adminToken, categoryId);
      const staffEmail = `role-gate-staff-${runId}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Viewer',
          email: staffEmail,
          password: 'password123',
          role: 'viewer',
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: 'password123' })
        .expect(201);
      const viewerToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .post(`/products/${product.id}/duplicate`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });
  });
});
