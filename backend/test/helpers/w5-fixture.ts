import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';
import { verifySignupEmail } from './verify-signup-email';

// Shared fixtures for the W5 money & stock coverage specs. Behaviour-level:
// everything goes through HTTP or a public service method, and every shop is
// namespaced with a runId so nothing here depends on a clean database.

export function body<T>(res: Response): T {
  return res.body as T;
}

export interface W5Shop {
  slug: string;
  shopId: number;
  adminToken: string;
  outletId: number;
  collectionId: number;
}

export async function bootApp() {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return { app, db: app.get(DatabaseService) };
}

export function makeFixtures(app: INestApplication<App>, db: DatabaseService) {
  const http = () => app.getHttpServer();
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let seq = 0;
  const uniq = () => `${runId}-${++seq}`;

  async function setupShop(prefix: string): Promise<W5Shop> {
    const slug = `${prefix}-${runId}`;
    const signup = await request(http())
      .post('/auth/signup')
      .send({
        name: 'W5 Admin',
        email: `${slug}@test.com`,
        password: 'password123',
        shopName: `${slug} Shop`,
        subdomain: slug,
      })
      .expect(201);
    const adminToken = body<{ accessToken: string }>(signup).accessToken;
    await verifySignupEmail(
      http(),
      body<{ devVerificationLink?: string }>(signup).devVerificationLink,
    );
    const outlets = await request(http())
      .get('/outlets')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const outletId = body<{ id: number }[]>(outlets)[0].id;
    await request(http())
      .patch(`/outlets/${outletId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, pickupEnabled: true })
      .expect(200);
    const collection = await request(http())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Goods' })
      .expect(201);
    const [shopRow] = await db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [slug],
    );
    return {
      slug,
      shopId: shopRow.id as number,
      adminToken,
      outletId,
      collectionId: body<{ id: number }>(collection).id,
    };
  }

  // Publishing needs at least one product to exist, so call after creating one.
  async function publish(shop: W5Shop) {
    await request(http())
      .patch('/shop')
      .set('Authorization', `Bearer ${shop.adminToken}`)
      .send({ published: true })
      .expect(200);
  }

  const auth = (shop: W5Shop) => ({
    Authorization: `Bearer ${shop.adminToken}`,
  });

  async function createIngredient(
    shop: W5Shop,
    name: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await request(http())
      .post('/shop/ingredients')
      .set(auth(shop))
      .send({ name: `${name} ${uniq()}`, unit: 'unit', ...extra })
      .expect(201);
    return body<{ id: number; name: string }>(res);
  }

  async function stockIngredient(
    shop: W5Shop,
    ingredientId: number,
    qty: number,
    outletId = shop.outletId,
  ) {
    await request(http())
      .post('/products/stock/adjust')
      .set(auth(shop))
      .send({ ingredientId, outletId, delta: qty, reason: 'received' })
      .expect(201);
  }

  async function createProduct(
    shop: W5Shop,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(http())
      .post('/products')
      .set(auth(shop))
      .send({
        name: `Item ${uniq()}`,
        price: 100,
        thumbnail: 'https://example.com/t.jpg',
        sku: `W5-${uniq()}`,
        trackInventory: true,
        collectionIds: [shop.collectionId],
        ...overrides,
      })
      .expect(201);
    return body<{ id: number; name: string }>(res);
  }

  // A plain (non-recipe) product with `stock` units at the shop's outlet.
  async function stockedProduct(
    shop: W5Shop,
    stock: number,
    overrides: Record<string, unknown> = {},
  ) {
    const product = await createProduct(shop, overrides);
    if (stock !== 0) {
      await request(http())
        .post('/products/stock/adjust')
        .set(auth(shop))
        .send({
          productId: product.id,
          outletId: shop.outletId,
          delta: stock,
          reason: 'received',
        })
        .expect(201);
    }
    return product;
  }

  async function addVariants(
    shop: W5Shop,
    productId: number,
    values: string[],
  ) {
    const res = await request(http())
      .put(`/products/${productId}/options`)
      .set(auth(shop))
      .send({ options: [{ name: 'Size', values }] })
      .expect(200);
    return body<{ variants: { id: number; label: string }[] }>(res).variants;
  }

  // ---- orders ----
  async function adminOrder(
    shop: W5Shop,
    items: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) {
    const res = await request(http())
      .post('/orders')
      .set(auth(shop))
      .send({
        customerName: 'W5 Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup',
        outletId: shop.outletId,
        orderType: 'pickup',
        items,
        ...extra,
      })
      .expect(201);
    return body<{ id: number; status: string; total: string }>(res);
  }

  async function storefrontOrder(
    shop: W5Shop,
    items: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
    expectStatus = 201,
  ) {
    const res = await request(http())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'W5 Storefront Customer',
        customerPhone: '0509990000',
        customerAddress: 'Pickup',
        items,
        ...extra,
      })
      .expect(expectStatus);
    return res;
  }

  // Same as storefrontOrder but asserts nothing, for races where either outcome is legal.
  function storefrontOrderRaw(
    shop: W5Shop,
    items: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) {
    return request(http())
      .post(`/public/${shop.slug}/orders`)
      .send({
        outletId: shop.outletId,
        orderType: 'pickup',
        paymentMethod: 'cash_on_pickup',
        customerName: 'W5 Racer',
        customerPhone: '0509990000',
        customerAddress: 'Pickup',
        items,
        ...extra,
      });
  }

  async function setStatus(shop: W5Shop, orderId: number, status: string) {
    await request(http())
      .patch(`/orders/${orderId}/status`)
      .set(auth(shop))
      .send({ status })
      .expect(200);
  }

  function cancelOrder(shop: W5Shop, orderId: number) {
    return request(http()).post(`/orders/${orderId}/cancel`).set(auth(shop));
  }

  function editItems(
    shop: W5Shop,
    orderId: number,
    items: Record<string, unknown>[],
  ) {
    return request(http())
      .patch(`/orders/${orderId}/items`)
      .set(auth(shop))
      .send({ items });
  }

  // Walks an admin order through the happy path up to (and including) `to`.
  async function advance(shop: W5Shop, orderId: number, to: string) {
    const path = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];
    for (const s of path) {
      await setStatus(shop, orderId, s);
      if (s === to) return;
    }
  }

  // ---- stock + ledger reads (the REAL tables: outletingredientstock + stockmovement) ----
  async function shadowIngredientId(productId: number, variantId?: number) {
    const rows = await db.query<RowDataPacket[]>(
      variantId
        ? `SELECT id FROM ingredient WHERE shadowVariantId = ?`
        : `SELECT id FROM ingredient WHERE shadowProductId = ?`,
      [variantId ?? productId],
    );
    return rows[0]?.id as number | undefined;
  }

  async function stockOf(outletId: number, ingredientId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
      [outletId, ingredientId],
    );
    return (rows[0]?.stockQuantity as number | undefined) ?? 0;
  }

  async function productStock(
    outletId: number,
    productId: number,
    variantId?: number,
  ) {
    const id = await shadowIngredientId(productId, variantId);
    return id === undefined ? 0 : stockOf(outletId, id);
  }

  // Sum of every non-TRANSFER movement delta for one (outlet, ingredient).
  // Conservation holds when this equals stockOf() for an ingredient whose row
  // only ever changed through logged movements. (TRANSFER rows record the
  // quantity once against the source outlet with the opposite sign convention,
  // so they are excluded; none of these specs transfer.)
  async function ledgerSum(outletId: number, ingredientId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(delta), 0) AS s FROM stockmovement
        WHERE outletId = ? AND ingredientId = ? AND type <> 'TRANSFER'`,
      [outletId, ingredientId],
    );
    return Number(rows[0].s);
  }

  async function movements(
    outletId: number,
    ingredientId: number,
    type?: string,
  ) {
    return db.query<RowDataPacket[]>(
      `SELECT type, delta, productId, variantId, ingredientId, note, reason, actorUserId
         FROM stockmovement WHERE outletId = ? AND ingredientId = ?
          ${type ? 'AND type = ?' : ''} ORDER BY id`,
      type ? [outletId, ingredientId, type] : [outletId, ingredientId],
    );
  }

  async function orderRow(orderId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT * FROM \`order\` WHERE id = ?`,
      [orderId],
    );
    return rows[0];
  }

  function orderItems(orderId: number) {
    return db.query<RowDataPacket[]>(
      `SELECT * FROM orderitem WHERE orderId = ? ORDER BY id`,
      [orderId],
    );
  }

  async function setShop(shop: W5Shop, patch: Record<string, unknown>) {
    await request(http())
      .patch('/shop')
      .set(auth(shop))
      .send(patch)
      .expect(200);
  }

  async function createDiscount(
    shop: W5Shop,
    overrides: Record<string, unknown>,
  ) {
    const res = await request(http())
      .post('/shop/discounts')
      .set(auth(shop))
      .send({
        code: `W5${uniq().replace(/-/g, '')}`.slice(0, 30),
        type: 'PERCENTAGE',
        value: 10,
        ...overrides,
      })
      .expect(201);
    return body<{ id: number; code: string | null }>(res);
  }

  async function taxClasses(shop: W5Shop) {
    const res = await request(http())
      .get('/tax-classes')
      .set(auth(shop))
      .expect(200);
    return body<
      { id: number; type: string; rate: string; isDefault: boolean }[]
    >(res);
  }

  return {
    http,
    runId,
    createDiscount,
    taxClasses,
    uniq,
    auth,
    setupShop,
    publish,
    createIngredient,
    stockIngredient,
    createProduct,
    stockedProduct,
    addVariants,
    adminOrder,
    storefrontOrder,
    storefrontOrderRaw,
    setStatus,
    cancelOrder,
    editItems,
    advance,
    shadowIngredientId,
    stockOf,
    productStock,
    ledgerSum,
    movements,
    orderRow,
    orderItems,
    setShop,
  };
}
