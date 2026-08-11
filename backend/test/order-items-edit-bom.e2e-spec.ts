import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import type { RowDataPacket } from 'mysql2/promise';

interface AuthResponse {
  accessToken: string;
}
interface IdRow {
  id: number;
}
interface OutletRow {
  id: number;
}
interface IngredientRow {
  id: number;
}
interface ProductRow {
  id: number;
}
interface OrderRow {
  id: number;
  status: string;
  ingredientStockWarnings?: string[];
}

function body<T>(res: Response): T {
  return res.body as T;
}

// Covers the same "quantity edit on a confirmed order must adjust
// ingredient stock by delta, not recompute from scratch" ground as
// bill-of-materials.e2e-spec.ts's own confirm/cancel coverage, but for the
// PATCH /orders/:id/items edit path specifically — that spec never touches
// item edits, and order-items-edit.e2e-spec.ts never touches ingredients.
describe('Order item edits: BOM ingredient stock deduction (e2e)', () => {
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
    const slug = `${slugPrefix}-${runId}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'BOM Edit Test Admin',
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

    const collection = await request(app.getHttpServer())
      .post('/collections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Flowers' })
      .expect(201);
    const collectionId = body<IdRow>(collection).id;

    return { adminToken, outletId, collectionId, slug };
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
    collectionId: number,
    ingredientId: number,
    quantityPerUnit: number,
  ) {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bouquet',
        price: 50,
        thumbnail: 'https://example.com/bouquet.jpg',
        sku: `BOMEDIT-${runId}-${Math.random().toString(36).slice(2, 8)}`,
        trackInventory: true,
        collectionIds: [collectionId],
        ingredients: [{ ingredientId, quantityPerUnit }],
      })
      .expect(201);
    return body<ProductRow>(res).id;
  }

  async function roseStockOf(outletId: number, ingredientId: number) {
    const rows = await db.query<RowDataPacket[]>(
      `SELECT stockQuantity FROM outletingredientstock WHERE outletId = ? AND ingredientId = ?`,
      [outletId, ingredientId],
    );
    return (rows[0]?.stockQuantity as number | undefined) ?? 0;
  }

  async function createAndConfirmOrder(
    adminToken: string,
    outletId: number,
    productId: number,
    quantity: number,
  ) {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'BOM Edit Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        items: [{ productId, quantity }],
      })
      .expect(201);
    const orderId = body<OrderRow>(created).id;
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'confirmed' })
      .expect(200);
    return orderId;
  }

  it('increasing quantity on a confirmed order deducts only the delta from ingredient stock', async () => {
    const { adminToken, collectionId, outletId } = await setupShop('increase');
    const rose = await createIngredient(adminToken, 'Rose');
    await setIngredientStock(adminToken, rose, outletId, 1000);
    const productId = await createProduct(adminToken, collectionId, rose, 6);

    const orderId = await createAndConfirmOrder(
      adminToken,
      outletId,
      productId,
      2,
    );
    expect(await roseStockOf(outletId, rose)).toBe(1000 - 6 * 2);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 5 }] }) // +3 delta
      .expect(200);

    // Only the +3 delta (18) was deducted on top of what confirm already
    // took (12) — not a from-scratch recompute for quantity 5 (30).
    expect(await roseStockOf(outletId, rose)).toBe(1000 - 6 * 5);
  });

  it('decreasing quantity on a confirmed order returns only the delta to ingredient stock', async () => {
    const { adminToken, collectionId, outletId } = await setupShop('decrease');
    const rose = await createIngredient(adminToken, 'Rose');
    await setIngredientStock(adminToken, rose, outletId, 1000);
    const productId = await createProduct(adminToken, collectionId, rose, 6);

    const orderId = await createAndConfirmOrder(
      adminToken,
      outletId,
      productId,
      5,
    );
    expect(await roseStockOf(outletId, rose)).toBe(1000 - 6 * 5);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 2 }] }) // -3 delta
      .expect(200);

    expect(await roseStockOf(outletId, rose)).toBe(1000 - 6 * 2);
  });

  it('cancelling after an edit returns exactly the currently-reserved ingredient stock, not the original amount', async () => {
    const { adminToken, collectionId, outletId } =
      await setupShop('cancel-after-edit');
    const rose = await createIngredient(adminToken, 'Rose');
    await setIngredientStock(adminToken, rose, outletId, 1000);
    const productId = await createProduct(adminToken, collectionId, rose, 6);

    const orderId = await createAndConfirmOrder(
      adminToken,
      outletId,
      productId,
      2,
    );
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 5 }] })
      .expect(200);
    expect(await roseStockOf(outletId, rose)).toBe(1000 - 6 * 5);

    await request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(await roseStockOf(outletId, rose)).toBe(1000);
  });

  it('editing a still-pending order does not touch ingredient stock at all', async () => {
    const { adminToken, collectionId, outletId } =
      await setupShop('pending-edit');
    const rose = await createIngredient(adminToken, 'Rose');
    await setIngredientStock(adminToken, rose, outletId, 1000);
    const productId = await createProduct(adminToken, collectionId, rose, 6);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerName: 'Pending Customer',
        customerPhone: '0501234567',
        customerAddress: 'Pickup',
        emirate: 'Dubai',
        outletId,
        orderType: 'pickup',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);
    const orderId = body<OrderRow>(created).id;
    expect(await roseStockOf(outletId, rose)).toBe(1000); // never consumed while pending

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 4 }] })
      .expect(200);

    expect(await roseStockOf(outletId, rose)).toBe(1000);
  });

  it('a quantity increase that would take ingredient stock negative warns but still saves', async () => {
    const { adminToken, collectionId, outletId } =
      await setupShop('negative-warn');
    const rose = await createIngredient(adminToken, 'Rose');
    await setIngredientStock(adminToken, rose, outletId, 10); // exactly one unit's worth
    const productId = await createProduct(adminToken, collectionId, rose, 10);

    const orderId = await createAndConfirmOrder(
      adminToken,
      outletId,
      productId,
      1,
    );
    expect(await roseStockOf(outletId, rose)).toBe(0);

    const res = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ productId, quantity: 2 }] }) // +1 delta, needs 10 more Rose, only 0 left
      .expect(200); // never blocked

    expect(body<OrderRow>(res).ingredientStockWarnings).toContain('Rose');
    expect(await roseStockOf(outletId, rose)).toBe(-10);
  });

  it("editing an order from another shop is rejected and never touches the correct shop's ingredient stock", async () => {
    const shopA = await setupShop('victim');
    const shopB = await setupShop('attacker');
    const rose = await createIngredient(shopA.adminToken, 'Rose');
    await setIngredientStock(shopA.adminToken, rose, shopA.outletId, 1000);
    const productId = await createProduct(
      shopA.adminToken,
      shopA.collectionId,
      rose,
      6,
    );
    const orderId = await createAndConfirmOrder(
      shopA.adminToken,
      shopA.outletId,
      productId,
      2,
    );
    expect(await roseStockOf(shopA.outletId, rose)).toBe(1000 - 12);

    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${shopB.adminToken}`)
      .send({ items: [{ productId, quantity: 99 }] })
      .expect(404);

    // Shop A's ingredient stock is completely untouched by shop B's attempt.
    expect(await roseStockOf(shopA.outletId, rose)).toBe(1000 - 12);
  });
});
