import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { verifySignupEmail } from './helpers/verify-signup-email';
import { getShadowStockQuantity } from './helpers/stock';

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
interface VariantRow {
  id: number;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  label: string | null;
  optionValue1Id: number | null;
  optionValue2Id: number | null;
  optionValue3Id: number | null;
  stockQuantity: number | null;
  imageId: number | null;
  imageUrl: string | null;
}
interface OptionRow {
  id: number;
  name: string;
  values: { id: number; value: string }[];
}
interface ProductRow {
  id: number;
  thumbnail: string;
  hasVariants: boolean;
  options: OptionRow[];
  variants: VariantRow[];
  images: { id: number; url: string; order: number }[];
  attributes: { id: number; name: string; value: string; order: number }[];
  faqs: { id: number; question: string; answer: string; order: number }[];
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

describe('Products / variants (e2e)', () => {
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

  // Mirrors the setup pattern already used in bio-links/storefront-checkout
  // e2e specs — signup, configure an orderable outlet, one category, one
  // product. Publishing (if requested) must come last — the readiness gate
  // needs the outlet + product to already exist.
  async function setupShop(
    slugPrefix: string,
    opts: { publish?: boolean } = {},
  ) {
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Products Test Admin',
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

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'General' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    if (opts.publish) {
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
    }

    return { adminToken, outletId, categoryId, slug };
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
        name: `T-Shirt ${Math.random()}`,
        price: 100,
        thumbnail: 'https://example.com/shirt.jpg',
        sku: `SHIRT-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        categoryIds: [categoryId],
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  describe('backward compatibility', () => {
    it('a product created with no options/images behaves exactly as before (single implicit variant)', async () => {
      const { adminToken, categoryId } = await setupShop('compat');
      const product = await createProduct(adminToken, categoryId, {
        thumbnail: 'https://example.com/legacy.jpg',
      });
      expect(product.hasVariants).toBe(false);
      expect(product.options).toEqual([]);
      expect(product.variants).toEqual([]);
      expect(product.images).toEqual([]);
      expect(product.thumbnail).toBe('https://example.com/legacy.jpg');
    });
  });

  describe('media gallery', () => {
    it('images[0].url becomes the canonical thumbnail, overriding the legacy field', async () => {
      const { adminToken, categoryId } = await setupShop('gallery');
      const product = await createProduct(adminToken, categoryId, {
        thumbnail: 'https://example.com/ignored.jpg',
        images: [
          { url: 'https://example.com/second.jpg', order: 1 },
          { url: 'https://example.com/first.jpg', order: 0 },
        ],
      });
      expect(product.thumbnail).toBe('https://example.com/first.jpg');
      expect(product.images).toHaveLength(2);
    });

    it('omitting images on update leaves the existing gallery/thumbnail untouched', async () => {
      const { adminToken, categoryId } = await setupShop('gallery-update');
      const product = await createProduct(adminToken, categoryId, {
        images: [{ url: 'https://example.com/first.jpg', order: 0 }],
      });
      const res = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed' })
        .expect(200);
      expect(body<ProductRow>(res).thumbnail).toBe(
        'https://example.com/first.jpg',
      );
      expect(body<ProductRow>(res).images).toHaveLength(1);
    });

    // Regression test: images used to be deleted and fully recreated (fresh
    // ids) on every update that resent the gallery — which the frontend
    // always does — so productvariant.imageId (onDelete: SetNull) got
    // silently wiped on the very next unrelated product save. Images are
    // now upserted by url, so an id (and anything referencing it) survives
    // a save that resends the same url, and is only actually cleared when
    // the url is genuinely removed.
    it('a variant image assignment survives a later product save that resends the same images', async () => {
      const { adminToken, categoryId } = await setupShop(
        'gallery-variant-stable',
      );
      const product = await createProduct(adminToken, categoryId, {
        price: 40,
        images: [
          { url: 'https://example.com/a.jpg', order: 0 },
          { url: 'https://example.com/b.jpg', order: 1 },
        ],
      });
      const imageId = product.images.find(
        (i) => i.url === 'https://example.com/b.jpg',
      )!.id;

      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small'] }] })
        .expect(200);
      const listRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const variant = body<ProductRow>(listRes).variants[0];

      await request(app.getHttpServer())
        .patch(`/products/${product.id}/variants/${variant.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ imageId })
        .expect(200);

      // Unrelated edit that resends the exact same images array, same as
      // ProductForm's own handleSubmit always does.
      await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Renamed after variant image set',
          images: [
            { url: 'https://example.com/a.jpg', order: 0 },
            { url: 'https://example.com/b.jpg', order: 1 },
          ],
        })
        .expect(200);

      const afterRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const afterVariant = body<ProductRow>(afterRes).variants[0];
      expect(afterVariant.imageId).toBe(imageId);
      expect(afterVariant.imageUrl).toBe('https://example.com/b.jpg');
      // The image row itself kept the same id too, not just the variant's
      // reference to it.
      expect(
        body<ProductRow>(afterRes).images.find(
          (i) => i.url === 'https://example.com/b.jpg',
        )?.id,
      ).toBe(imageId);
    });

    it('removing an image from the gallery clears a variant that was pointing at it, but leaves the others alone', async () => {
      const { adminToken, categoryId } = await setupShop(
        'gallery-variant-removed',
      );
      const product = await createProduct(adminToken, categoryId, {
        price: 40,
        images: [
          { url: 'https://example.com/keep.jpg', order: 0 },
          { url: 'https://example.com/drop.jpg', order: 1 },
        ],
      });
      const dropId = product.images.find(
        (i) => i.url === 'https://example.com/drop.jpg',
      )!.id;

      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small'] }] })
        .expect(200);
      const listRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const variant = body<ProductRow>(listRes).variants[0];
      await request(app.getHttpServer())
        .patch(`/products/${product.id}/variants/${variant.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ imageId: dropId })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ images: [{ url: 'https://example.com/keep.jpg', order: 0 }] })
        .expect(200);

      const afterRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const afterProduct = body<ProductRow>(afterRes);
      expect(afterProduct.images).toHaveLength(1);
      expect(afterProduct.variants[0].imageId).toBeNull();
    });
  });

  describe('options -> variant generation and reconciliation', () => {
    it('two options generate the full cartesian product, inheriting price from the product', async () => {
      const { adminToken, categoryId } = await setupShop('gen');
      const product = await createProduct(adminToken, categoryId, {
        price: 75,
      });

      const res = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          options: [
            { name: 'Size', values: ['Small', 'Medium', 'Large'] },
            { name: 'Color', values: ['Red', 'Blue'] },
          ],
        })
        .expect(200);
      const updated = body<ProductRow>(res);
      expect(updated.hasVariants).toBe(true);
      expect(updated.variants).toHaveLength(6);
      expect(updated.variants.map((v) => v.label).sort()).toEqual(
        [
          'Small / Red',
          'Small / Blue',
          'Medium / Red',
          'Medium / Blue',
          'Large / Red',
          'Large / Blue',
        ].sort(),
      );
      for (const v of updated.variants) {
        expect(v.price).toBe('75');
      }
    });

    it('editing a variant then adding a new option value preserves the edited variant and only creates the new combos', async () => {
      const { adminToken, categoryId } = await setupShop('reconcile');
      const product = await createProduct(adminToken, categoryId, {
        price: 50,
      });
      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small', 'Medium'] }] })
        .expect(200);

      const listRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const smallVariant = body<ProductRow>(listRes).variants.find(
        (v) => v.label === 'Small',
      )!;

      await request(app.getHttpServer())
        .patch(`/products/${product.id}/variants/${smallVariant.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 999, sku: 'CUSTOM-SMALL-SKU' })
        .expect(200);

      // Adding a value ("Large") should not disturb the Small/Medium variants
      // at all — the edited Small variant must keep its custom price/sku.
      const afterRes = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          options: [{ name: 'Size', values: ['Small', 'Medium', 'Large'] }],
        })
        .expect(200);
      const after = body<ProductRow>(afterRes);
      expect(after.variants).toHaveLength(3);
      const stillSmall = after.variants.find((v) => v.id === smallVariant.id)!;
      expect(stillSmall).toBeDefined();
      expect(stillSmall.price).toBe('999');
      expect(stillSmall.sku).toBe('CUSTOM-SMALL-SKU');
      const large = after.variants.find((v) => v.label === 'Large')!;
      expect(large.price).toBe('50'); // fresh variant inherits current product price
    });

    it('removing an option value deletes the corresponding variants', async () => {
      const { adminToken, categoryId } = await setupShop('remove-value');
      const product = await createProduct(adminToken, categoryId);
      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          options: [{ name: 'Size', values: ['Small', 'Medium', 'Large'] }],
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small', 'Medium'] }] })
        .expect(200);
      const updated = body<ProductRow>(res);
      expect(updated.variants).toHaveLength(2);
      expect(updated.variants.map((v) => v.label).sort()).toEqual([
        'Medium',
        'Small',
      ]);
    });

    it('an empty options array wipes all options/variants, reverting to a single implicit variant', async () => {
      const { adminToken, categoryId } = await setupShop('wipe');
      const product = await createProduct(adminToken, categoryId);
      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small', 'Large'] }] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [] })
        .expect(200);
      const updated = body<ProductRow>(res);
      expect(updated.hasVariants).toBe(false);
      expect(updated.options).toEqual([]);
      expect(updated.variants).toEqual([]);
    });

    it('rejects more than 3 options', async () => {
      const { adminToken, categoryId } = await setupShop('too-many-options');
      const product = await createProduct(adminToken, categoryId);
      const res = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          options: [
            { name: 'A', values: ['1'] },
            { name: 'B', values: ['1'] },
            { name: 'C', values: ['1'] },
            { name: 'D', values: ['1'] },
          ],
        })
        .expect(400);
      expect(messageContains(res, 'options')).toBe(true);
    });

    it('rejects an option combination that would exceed 100 variants, without creating any', async () => {
      const { adminToken, categoryId } = await setupShop('cap');
      const product = await createProduct(adminToken, categoryId);
      const res = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          options: [
            {
              name: 'Size',
              values: Array.from({ length: 11 }, (_, i) => `S${i}`),
            },
            {
              name: 'Color',
              values: Array.from({ length: 10 }, (_, i) => `C${i}`),
            },
          ],
        })
        .expect(400);
      expect(messageContains(res, '100')).toBe(true);

      const check = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(body<ProductRow>(check).variants).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it("rejects options/variant writes against another shop's product", async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      const productA = await createProduct(shopA.adminToken, shopA.categoryId);

      await request(app.getHttpServer())
        .put(`/products/${productA.id}/options`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small'] }] })
        .expect(404);

      await request(app.getHttpServer())
        .put(`/products/${productA.id}/options`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small'] }] })
        .expect(200);
      const listRes = await request(app.getHttpServer())
        .get(`/products/${productA.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .expect(200);
      const variantId = body<ProductRow>(listRes).variants[0].id;

      await request(app.getHttpServer())
        .patch(`/products/${productA.id}/variants/${variantId}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({ price: 1 })
        .expect(404);
    });

    it("rejects attribute/FAQ writes against another shop's product, and a foreign product update never leaks a second shop's attributes/FAQs", async () => {
      const shopA = await setupShop('attrs-tenant-a');
      const shopB = await setupShop('attrs-tenant-b');
      const productA = await createProduct(shopA.adminToken, shopA.categoryId);

      await request(app.getHttpServer())
        .patch(`/products/${productA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .send({
          attributes: [{ name: 'Material', value: 'Cotton' }],
          faqs: [{ question: 'Is it washable?', answer: 'Yes' }],
        })
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/products/${productA.id}`)
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          attributes: [{ name: 'Material', value: 'Cotton' }],
          faqs: [{ question: 'Is it washable?', answer: 'Yes' }],
        })
        .expect(200);

      const check = await request(app.getHttpServer())
        .get(`/products/${productA.id}`)
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(404);
      expect(check.status).toBe(404);
    });
  });

  describe('attributes and FAQs', () => {
    it('creates, replaces, and clears attributes/FAQs on a product', async () => {
      const { adminToken, categoryId } = await setupShop('attrs-faqs');
      const product = await createProduct(adminToken, categoryId, {
        attributes: [{ name: 'Material', value: 'Cotton' }],
        faqs: [{ question: 'Is it washable?', answer: 'Yes' }],
      });
      expect(product.attributes).toEqual([
        expect.objectContaining({
          name: 'Material',
          value: 'Cotton',
          order: 0,
        }),
      ]);
      expect(product.faqs).toEqual([
        expect.objectContaining({
          question: 'Is it washable?',
          answer: 'Yes',
          order: 0,
        }),
      ]);

      const replaced = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          attributes: [
            { name: 'Material', value: 'Wool' },
            { name: 'Origin', value: 'UAE' },
          ],
          faqs: [],
        })
        .expect(200);
      expect(body<ProductRow>(replaced).attributes.map((a) => a.value)).toEqual(
        ['Wool', 'UAE'],
      );
      expect(body<ProductRow>(replaced).faqs).toEqual([]);

      const cleared = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attributes: [] })
        .expect(200);
      expect(body<ProductRow>(cleared).attributes).toEqual([]);
    });

    it('omitting attributes/faqs on update leaves the existing set untouched (same convention as images)', async () => {
      const { adminToken, categoryId } = await setupShop('attrs-untouched');
      const product = await createProduct(adminToken, categoryId, {
        attributes: [{ name: 'Material', value: 'Cotton' }],
      });
      const updated = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Renamed' })
        .expect(200);
      expect(body<ProductRow>(updated).attributes).toEqual([
        expect.objectContaining({ name: 'Material', value: 'Cotton' }),
      ]);
    });
  });

  describe('per-product Variants/Attributes/FAQs opt-in (showVariants/showAttributes/showFaqs)', () => {
    it('defaults all three to false, and round-trips explicit values on create and update', async () => {
      const { adminToken, categoryId } = await setupShop('feature-toggles');
      const product = await createProduct(adminToken, categoryId, {});
      expect(product).toEqual(
        expect.objectContaining({
          showVariants: false,
          showAttributes: false,
          showFaqs: false,
        }),
      );

      const withToggles = await createProduct(adminToken, categoryId, {
        showVariants: true,
        showAttributes: true,
        showFaqs: true,
      });
      expect(withToggles).toEqual(
        expect.objectContaining({
          showVariants: true,
          showAttributes: true,
          showFaqs: true,
        }),
      );

      const updated = await request(app.getHttpServer())
        .patch(`/products/${withToggles.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ showVariants: false })
        .expect(200);
      expect(body<ProductRow>(updated)).toEqual(
        expect.objectContaining({
          showVariants: false,
          showAttributes: true,
          showFaqs: true,
        }),
      );
    });
  });

  describe('order creation resolves the specific variant', () => {
    it("requires a variantId for a variant-bearing product and resolves its price/sku/stock, not the parent product's", async () => {
      const { adminToken, outletId, categoryId, slug } =
        await setupShop('order-variant');
      const product = await createProduct(adminToken, categoryId, {
        price: 100,
        sku: `PARENT-${runId}`,
      });
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small', 'Large'] }] })
        .expect(200);
      const readRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const variants = body<ProductRow>(readRes).variants;
      const small = variants.find((v) => v.label === 'Small')!;

      await request(app.getHttpServer())
        .patch(`/products/${product.id}/variants/${small.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 40, sku: 'VARIANT-SMALL-SKU' })
        .expect(200);

      // Ordering the parent product without a variantId must be rejected.
      await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send({
          outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Main St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: product.id, quantity: 1 }],
        })
        .expect(400);

      // Untracked inventory (default) — no stock rows needed; order resolves
      // the variant's own overridden price, not the parent product's.
      const orderRes = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send({
          outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Main St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: product.id, variantId: small.id, quantity: 2 }],
        })
        .expect(201);
      const order = body<{ order: { id: number; total: string } }>(
        orderRes,
      ).order;

      const detail = await prisma.orderitem.findFirst({
        where: { orderId: order.id },
      });
      expect(detail?.variantId).toBe(small.id);
      expect(detail?.variantLabel).toBe('Small');
      expect(Number(detail?.priceAtPurchase)).toBe(40);
    });

    it("decrements the variant's own outletvariantstock, leaving the parent product's outletstock untouched", async () => {
      const { adminToken, outletId, categoryId, slug } = await setupShop(
        'order-variant-stock',
      );
      const product = await createProduct(adminToken, categoryId, {
        trackInventory: true,
      });
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
      await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small', 'Large'] }] })
        .expect(200);
      const readRes = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const small = body<ProductRow>(readRes).variants.find(
        (v) => v.label === 'Small',
      )!;

      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          outletId,
          adjustments: [
            { productId: product.id, variantId: small.id, delta: 5 },
          ],
        })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send({
          outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Main St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: product.id, variantId: small.id, quantity: 3 }],
        })
        .expect(201);

      const variantStock = await getShadowStockQuantity(prisma, outletId, {
        productId: product.id,
        variantId: small.id,
      });
      expect(variantStock).toBe(2);
      // A variant-carrying product never gets a product-level shadow
      // ingredient (Phase A) — only one per variant, see
      // ingredient.shadowProductId's schema comment — so there's no
      // product-level stock row to find at all, same "stays untouched"
      // assertion as the pre-Phase-A direct outletstock check.
      const productShadow = await prisma.ingredient.findFirst({
        where: { shadowProductId: product.id },
      });
      expect(productShadow).toBeNull();

      // Out of stock — only 2 left, ordering 5 must be rejected, not
      // silently oversell.
      await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send({
          outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Main St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: product.id, variantId: small.id, quantity: 5 }],
        })
        .expect(409);
    });

    it('rejects a variantId for a product that has no variants', async () => {
      const { adminToken, outletId, categoryId, slug } =
        await setupShop('no-variant-reject');
      const product = await createProduct(adminToken, categoryId);
      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ published: true })
        .expect(200);
      const res = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send({
          outletId,
          orderType: 'delivery',
          paymentMethod: 'cash_on_delivery',
          customerName: 'Customer',
          customerPhone: '0501234567',
          customerAddress: '1 Main St',
          emirate: 'Dubai',
          latitude: 25.2048,
          longitude: 55.2708,
          items: [{ productId: product.id, variantId: 999999, quantity: 1 }],
        })
        .expect(400);
      expect(messageContains(res, 'variant')).toBe(true);
    });
  });
});
