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
  stockQuantity: number | null;
}
interface IngredientLinkRow {
  id: number;
  ingredientId: number;
  ingredientName: string;
  quantityPerUnit: number;
}
interface VariantRow {
  id: number;
  label: string | null;
  ingredientOverrides: IngredientLinkRow[];
  makeableQuantity: number | null;
  limitedByIngredient: string | null;
}
interface ProductRow {
  id: number;
  hasVariants: boolean;
  variants: VariantRow[];
  ingredients: IngredientLinkRow[];
  makeableQuantity: number | null;
  limitedByIngredient: string | null;
}
interface OrderRow {
  id: number;
  status: string;
  channel: string | null;
}
interface OrderCreateResponse {
  order: OrderRow;
}
interface MovementRow {
  id: number;
  ingredientId: number | null;
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

describe('Bill of Materials: recipes + ingredient auto-consumption (e2e)', () => {
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
        name: 'BOM Test Admin',
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
      .send({ active: true, emirate: 'Dubai', pickupEnabled: true })
      .expect(200);

    const category = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const categoryId = body<IdRow>(category).id;

    return { adminToken, outletId, categoryId, slug };
  }

  // Publishing requires the readiness bar (outlet + at least one product
  // must already exist — see ShopService.getPublishReadiness), so this is
  // only ever called after a product exists, and only by tests that
  // actually hit the storefront (/public/...) endpoints — admin-side tests
  // (recipe CRUD, the confirm-transition consumption test, which uses
  // admin POST /orders) never need it, since PublicService.assertPublished
  // has no admin-side equivalent gate.
  async function publishShop(adminToken: string) {
    await request(app.getHttpServer())
      .patch('/shop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true })
      .expect(200);
  }

  async function createIngredient(adminToken: string, name: string) {
    const res = await request(app.getHttpServer())
      .post('/shop/ingredients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, unit: 'stems' })
      .expect(201);
    return body<IngredientRow>(res).id;
  }

  async function setIngredientStock(
    adminToken: string,
    ingredientId: number,
    outletId: number,
    delta: number,
  ) {
    await request(app.getHttpServer())
      .post('/products/stock/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ingredientId, outletId, delta, reason: 'received' })
      .expect(201);
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
        name: 'Bouquet',
        price: 50,
        thumbnail: 'https://example.com/bouquet.jpg',
        sku: `BOM-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        categoryIds: [categoryId],
        ...overrides,
      })
      .expect(201);
    return body<ProductRow>(res);
  }

  function adminOrderPayload(
    outletId: number,
    productId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      customerName: 'BOM Customer',
      customerPhone: '0501234567',
      customerAddress: 'Pickup',
      emirate: 'Dubai',
      outletId,
      orderType: 'pickup',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }

  function storefrontOrderPayload(
    outletId: number,
    productId: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      outletId,
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      customerName: 'BOM Storefront Customer',
      customerPhone: '0509990000',
      customerAddress: 'Pickup',
      emirate: 'Dubai',
      items: [{ productId, quantity: 1 }],
      ...overrides,
    };
  }

  describe('recipe CRUD + variant-override resolution', () => {
    it('a product created with a recipe returns it, and updating replaces the full set', async () => {
      const { adminToken, categoryId } = await setupShop('crud');
      const rose = await createIngredient(adminToken, 'Rose');
      const box = await createIngredient(adminToken, 'Box');

      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 6 }],
      });
      expect(product.ingredients).toHaveLength(1);
      expect(product.ingredients[0]).toMatchObject({
        ingredientId: rose,
        ingredientName: 'Rose',
        quantityPerUnit: 6,
      });

      const updated = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ingredients: [{ ingredientId: box, quantityPerUnit: 1 }] })
        .expect(200);
      const updatedProduct = body<ProductRow>(updated);
      expect(updatedProduct.ingredients).toHaveLength(1);
      expect(updatedProduct.ingredients[0].ingredientId).toBe(box);

      // Omitted entirely on the next update — must leave the recipe untouched.
      const untouched = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bouquet Renamed' })
        .expect(200);
      expect(body<ProductRow>(untouched).ingredients).toHaveLength(1);

      // Empty array explicitly clears it.
      const cleared = await request(app.getHttpServer())
        .patch(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ingredients: [] })
        .expect(200);
      expect(body<ProductRow>(cleared).ingredients).toHaveLength(0);
    });

    it('rejects a recipe row referencing an ingredient from another shop', async () => {
      const shopA = await setupShop('tenant-a');
      const shopB = await setupShop('tenant-b');
      const foreignIngredient = await createIngredient(
        shopB.adminToken,
        'Foreign Rose',
      );

      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          name: 'Cross-tenant Bouquet',
          price: 50,
          thumbnail: 'https://example.com/x.jpg',
          sku: `BOM-XTENANT-${runId}`,
          categoryIds: [shopA.categoryId],
          ingredients: [
            { ingredientId: foreignIngredient, quantityPerUnit: 1 },
          ],
        })
        .expect(400);
      expect(messageContains(res, 'ingredientId')).toBe(true);
    });

    it('rejects the same ingredient linked twice in one recipe submission', async () => {
      const { adminToken, categoryId } = await setupShop('dup');
      const rose = await createIngredient(adminToken, 'Rose');
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Dup Bouquet',
          price: 50,
          thumbnail: 'https://example.com/x.jpg',
          sku: `BOM-DUP-${runId}`,
          categoryIds: [categoryId],
          ingredients: [
            { ingredientId: rose, quantityPerUnit: 6 },
            { ingredientId: rose, quantityPerUnit: 10 },
          ],
        })
        .expect(400);
      expect(messageContains(res, 'once per recipe')).toBe(true);
    });

    it('a variant override wins for that variant; a variant with no override falls back to the product default', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('override');
      const rose = await createIngredient(adminToken, 'Rose');
      await setIngredientStock(adminToken, rose, outletId, 1000);

      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 6 }],
      });
      const withOptions = await request(app.getHttpServer())
        .put(`/products/${product.id}/options`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ options: [{ name: 'Size', values: ['Small', 'Large'] }] })
        .expect(200);
      const variants = body<ProductRow>(withOptions).variants;
      const small = variants.find((v) => v.label === 'Small')!;
      const large = variants.find((v) => v.label === 'Large')!;

      // Small: no override configured — inherits the product default.
      expect(small.ingredientOverrides).toHaveLength(0);

      // Large: explicit override to 10 roses/unit.
      const largeUpdated = await request(app.getHttpServer())
        .patch(`/products/${product.id}/variants/${large.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ingredients: [{ ingredientId: rose, quantityPerUnit: 10 }] })
        .expect(200);
      expect(body<VariantRow>(largeUpdated).ingredientOverrides).toEqual([
        expect.objectContaining({ ingredientId: rose, quantityPerUnit: 10 }),
      ]);

      // Phase A: a usesIngredients:true product/variant has no settable
      // direct stock of its own anymore (bulk-adjust rejects it, see
      // resolveShadowStockTarget) — availability is purely ingredient-
      // derived, already set via setIngredientStock above.
      await publishShop(adminToken);

      // Ordering one of each must consume 6 (Small, product default) + 10
      // (Large, its own override) = 16 roses total, proving the fallback
      // resolution end-to-end, not just via the API response shape.
      const created = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          storefrontOrderPayload(outletId, product.id, {
            items: [
              { productId: product.id, variantId: small.id, quantity: 1 },
              { productId: product.id, variantId: large.id, quantity: 1 },
            ],
          }),
        )
        .expect(201);
      expect(body<OrderCreateResponse>(created).order.status).toBe('pending');

      const roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(1000 - 16);
    });
  });

  describe('consumption fires at the same trigger points as product stock, gated by the toggle', () => {
    it('storefront checkout (immediate reservation) consumes the recipe and logs a CONSUMED movement', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('consume-immediate');
      const rose = await createIngredient(adminToken, 'Rose');
      await setIngredientStock(adminToken, rose, outletId, 100);
      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 6 }],
      });
      await publishShop(adminToken);

      const created = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          storefrontOrderPayload(outletId, product.id, {
            items: [{ productId: product.id, quantity: 2 }],
          }),
        )
        .expect(201);
      const orderId = body<OrderCreateResponse>(created).order.id;

      const roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100 - 12); // 6 * 2

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(order.ingredientsConsumedAt).not.toBeNull();

      const movements = await request(app.getHttpServer())
        .get('/products/stock/movements')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ ingredientId: rose })
        .expect(200);
      const rows = body<MovementList>(movements).data;
      expect(rows.some((r) => r.type === 'CONSUMED' && r.delta === -12)).toBe(
        true,
      );
    });

    it('a product with no merchant-authored recipe consumes only its own shadow ingredient, never a real one', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('no-recipe');
      const product = await createProduct(adminToken, categoryId);
      await request(app.getHttpServer())
        .patch('/products/stock/bulk-adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ outletId, adjustments: [{ productId: product.id, delta: 20 }] })
        .expect(200);
      await publishShop(adminToken);

      await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(storefrontOrderPayload(outletId, product.id))
        .expect(201);

      // Phase A: every product resolves through consumeForOrderItems now,
      // even one with no merchant-authored recipe — its own auto-provisioned
      // shadow ingredient is what actually gets the CONSUMED row. This is
      // the single stock-decrement mechanism replacing the old, separate
      // (non-CONSUMED) product-stock write path — not a real Ingredient's
      // stock, still never touched for a plain product like this one.
      const movements = await request(app.getHttpServer())
        .get('/products/stock/movements')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ type: 'CONSUMED' })
        .expect(200);
      const rows = body<MovementList>(movements).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productId: product.id,
        delta: -1,
      });
    });

    it('respects the shop toggle: off means no deduction even though a recipe is linked', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('toggle-off');
      const rose = await createIngredient(adminToken, 'Rose');
      await setIngredientStock(adminToken, rose, outletId, 100);
      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 6 }],
      });
      await publishShop(adminToken);

      await request(app.getHttpServer())
        .patch('/shop')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ autoDeductIngredientStock: false })
        .expect(200);

      const created = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(storefrontOrderPayload(outletId, product.id))
        .expect(201);
      const orderId = body<OrderCreateResponse>(created).order.id;

      const roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100); // untouched

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(order.ingredientsConsumedAt).toBeNull();
    });

    it('a deferred admin order consumes at the pending->confirmed transition, not at creation', async () => {
      const { adminToken, categoryId, outletId } =
        await setupShop('consume-confirm');
      const rose = await createIngredient(adminToken, 'Rose');
      await setIngredientStock(adminToken, rose, outletId, 100);
      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 6 }],
      });

      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(adminOrderPayload(outletId, product.id))
        .expect(201);
      const orderId = body<OrderRow>(created).id;

      let roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100); // not yet consumed while pending

      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'confirmed' })
        .expect(200);

      roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100 - 6);

      // Cancelling a confirmed (ingredients-consumed) order restocks them.
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100);
    });

    it('cancelling a still-pending immediate-reservation order restocks ingredients immediately', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('cancel-immediate');
      const rose = await createIngredient(adminToken, 'Rose');
      await setIngredientStock(adminToken, rose, outletId, 100);
      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 6 }],
      });
      await publishShop(adminToken);

      const created = await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(storefrontOrderPayload(outletId, product.id))
        .expect(201);
      const orderId = body<OrderCreateResponse>(created).order.id;

      let roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100 - 6);

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(100);
    });
  });

  describe("effective availability (informational, doesn't gate checkout)", () => {
    it('makeableQuantity/limitedByIngredient reflect the binding ingredient at the resolved outlet', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('availability');
      const rose = await createIngredient(adminToken, 'Rose');
      const box = await createIngredient(adminToken, 'Box');
      await setIngredientStock(adminToken, rose, outletId, 25); // 25 / 10 = 2 makeable
      await setIngredientStock(adminToken, box, outletId, 100); // 100 / 1 = 100 makeable — not the binding one
      const product = await createProduct(adminToken, categoryId, {
        ingredients: [
          { ingredientId: rose, quantityPerUnit: 10 },
          { ingredientId: box, quantityPerUnit: 1 },
        ],
      });
      await publishShop(adminToken);

      const res = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ outletId })
        .expect(200);
      const fetched = body<ProductRow>(res);
      expect(fetched.makeableQuantity).toBe(2);
      expect(fetched.limitedByIngredient).toBe('Rose');

      // makeableQuantity/limitedByIngredient are a read-side display only —
      // checkout itself enforces the recipe by actually attempting the
      // decrement at consumption time (throwing there if insufficient, see
      // the race test below), never as a separate pre-emptive block based
      // on this displayed number. Ordering 1 (within what's makeable here)
      // still succeeds normally.
      await request(app.getHttpServer())
        .post(`/public/${slug}/orders`)
        .send(
          storefrontOrderPayload(outletId, product.id, {
            items: [{ productId: product.id, quantity: 1 }],
          }),
        )
        .expect(201);
    });
  });

  describe('race safety: concurrent orders against a nearly-depleted ingredient', () => {
    it('two concurrent storefront orders racing a recipe that only one can fully cover never overdraw the ingredient', async () => {
      const { adminToken, categoryId, outletId, slug } =
        await setupShop('bom-race');
      const rose = await createIngredient(adminToken, 'Rose');
      await setIngredientStock(adminToken, rose, outletId, 10); // exactly one order's worth (quantityPerUnit 10)
      const product = await createProduct(adminToken, categoryId, {
        ingredients: [{ ingredientId: rose, quantityPerUnit: 10 }],
      });
      await publishShop(adminToken);

      const attempt = () =>
        request(app.getHttpServer())
          .post(`/public/${slug}/orders`)
          .send(storefrontOrderPayload(outletId, product.id));

      const [a, b] = await Promise.all([attempt(), attempt()]);
      // Exactly one succeeds — the ingredient can only cover one order; the
      // loser must be rejected, never both silently succeeding and
      // overdrawing the ingredient below zero.
      const successCount = [a.status, b.status].filter((s) => s === 201).length;
      expect(successCount).toBe(1);

      const roseStock = await prisma.outletingredientstock.findUniqueOrThrow({
        where: { outletId_ingredientId: { outletId, ingredientId: rose } },
      });
      expect(roseStock.stockQuantity).toBe(0);
    });
  });
});
